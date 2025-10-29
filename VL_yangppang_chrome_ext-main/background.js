let autoHedgeState = {
    isRunning: false,
    intervalId: null,
    originalQuantity: '',
    coin: '',
    isHedging: false, 
    lockTimestamp: null
};

async function findTradingTabs() {
    const tabs = await chrome.tabs.query({});
    const lighterTab = tabs.find(tab => tab.url && tab.url.includes('app.lighter.xyz/trade/'));
    const variationalTab = tabs.find(tab => tab.url && tab.url.includes('omni.variational.io/perpetual/'));
    return { lighterTab, variationalTab };
}

function executeOnTab(tabId, file, functionName, args = []) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: [file],
        }, () => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (name, funcArgs) => window[name] && window[name](...funcArgs),
                args: [functionName, args],
            }, (injectionResults) => {
                if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
                resolve(injectionResults && injectionResults[0] ? injectionResults[0].result : null);
            });
        });
    });
}

function stopAutoHedge(errorMessage = null) {
    if (autoHedgeState.intervalId) {
        clearInterval(autoHedgeState.intervalId);
    }
    //if (!autoHedgeState.isRunning && !autoHedgeState.isHedging) return;

    autoHedgeState.isRunning = false;
    autoHedgeState.isHedging = false;
    autoHedgeState.lockTimestamp = null;
    autoHedgeState.intervalId = null;
    autoHedgeState.lastHedgeQuantity = null;

    chrome.runtime.sendMessage({
        action: 'updateAutoHedgeStatus',
        status: errorMessage ? `Error: ${errorMessage}` : 'Idle',
        originalQuantity: autoHedgeState.originalQuantity
    });
}

async function checkAndHedge(delta, lockTimeout) {
    if (!autoHedgeState.isRunning) return;

    try {
        if (autoHedgeState.isHedging) {
            const timeSinceLock = Date.now() - autoHedgeState.lockTimestamp;
            if (timeSinceLock > lockTimeout) {
                console.warn(`Lock Timeout (${lockTimeout}ms) exceeded. Forcing lock release.`);
                autoHedgeState.isHedging = false;
                autoHedgeState.lockTimestamp = null;
                chrome.runtime.sendMessage({ action: 'updateAutoHedgeStatus', status: 'Lock timed out, re-monitoring...' });
                return;
            }
            // 잠금 상태에서는 API 호출 없이 대기
            chrome.runtime.sendMessage({
                action: 'updateAutoHedgeStatus',
                status: `Waiting for hedge... (${Math.round(timeSinceLock / 1000)}s)`
            });
            return;
        }

        const { lighterTab, variationalTab } = await findTradingTabs();
        if (!lighterTab || !variationalTab) throw new Error('Trading tabs not found.');

        const [lighterPosArr, variationalPosArr] = await Promise.all([
            executeOnTab(lighterTab.id, 'lighter.js', 'getPositions', [autoHedgeState.coin]),
            executeOnTab(variationalTab.id, 'variational.js', 'getPositions', [autoHedgeState.coin])
        ]);

        const lPosData = lighterPosArr ? lighterPosArr.find(p => p.coin === autoHedgeState.coin) : null;
        const vPosData = variationalPosArr ? variationalPosArr.find(p => p.coin === autoHedgeState.coin) : null;

        // comment: 부호를 포함한 실제 포지션 크기 사용 (Abs 제거)
        const lSize = lPosData ? parseFloat(lPosData.position.replace(/,/g, '')) : 0;
        const vSize = vPosData ? parseFloat(vPosData.position.replace(/,/g, '')) : 0;
        
        // comment: 순포지션 계산
        const netPosition = lSize + vSize;
        const hedgeQuantity = Math.abs(netPosition);

        // 헷징 주문이 반영되면 잠금 해제
        if (hedgeQuantity < delta) {
            autoHedgeState.isHedging = false;
            autoHedgeState.lockTimestamp = null;
        }
        
        chrome.runtime.sendMessage({
            action: 'updateAutoHedgeStatus',
            status: `Monitoring... L:${lSize.toFixed(4)} V:${vSize.toFixed(4)} Net:${netPosition.toFixed(4)}`
        });
        
        // comment: 순포지션의 절대값이 delta 이상일 때만 주문 실행
        if (hedgeQuantity >= delta) {
            autoHedgeState.isHedging = true;
            autoHedgeState.lockTimestamp = Date.now();
            
            // comment: 순포지션의 부호에 따라 헷징 방향 결정
            const hedgeDirection = netPosition > 0 ? 'sell' : 'buy';
            const quantityToSet = String(hedgeQuantity.toFixed(5));

            console.log(`Delta(${delta}) 이상의 불균형(${hedgeQuantity}) 감지. Variational에 [${hedgeDirection}] 주문 실행.`);
            
            // comment: 이전 헷지 수량과 동일하면 setQuantity 스크립트 실행을 건너뛰는 최적화 로직
            if (quantityToSet !== autoHedgeState.lastHedgeQuantity) {
                console.log(`New hedge quantity detected. Updating input to ${quantityToSet}`);
                await executeOnTab(variationalTab.id, 'variational.js', 'setQuantity', [quantityToSet]);
                autoHedgeState.lastHedgeQuantity = quantityToSet; // 마지막 헷지 수량 업데이트
                await new Promise(resolve => setTimeout(resolve, 200)); // 수량 입력 필드 업데이트 대기
            }

            //await executeOnTab(variationalTab.id, 'variational.js', 'clickMarketButton');
            //await new Promise(resolve => setTimeout(resolve, 100));

            await executeOnTab(variationalTab.id, 'variational.js', 'selectOrderType', [hedgeDirection]);
            await new Promise(resolve => setTimeout(resolve, 200));

            await executeOnTab(variationalTab.id, 'variational.js', 'clickSubmitButton');
            
            chrome.runtime.sendMessage({
                action: 'updateAutoHedgeStatus',
                status: `Hedging ${hedgeQuantity.toFixed(4)} on Variational...`
            });

        }
    } catch (error) {
        console.error('자동 헤징 중 오류 발생:', error);
        stopAutoHedge(error.message);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        if (request.action === 'startAutoHedge') {
            if (autoHedgeState.isRunning) return;
            
            // comment: [치명적 오류 수정] 'autoHedgeState = { ... }'와 같이 객체를 완전히 새로 할당하면,
            // 기존 객체를 참조하는 stopAutoHedge 함수가 intervalId를 찾지 못해 clearInterval이 실패합니다.
            // 따라서 객체를 새로 만들지 않고, 기존 객체의 속성을 변경하는 방식으로 수정해야 합니다.
            autoHedgeState.isRunning = true;
            autoHedgeState.isHedging = false;
            autoHedgeState.lockTimestamp = null;
            autoHedgeState.lastHedgeQuantity = null;
            autoHedgeState.originalQuantity = request.originalQuantity;
            autoHedgeState.coin = request.coin;
            autoHedgeState.intervalId = setInterval(checkAndHedge, request.interval, request.delta, request.lockTimeout);

            chrome.runtime.sendMessage({ action: 'updateAutoHedgeStatus', status: 'Monitoring started...' });
            return;
        }

        if (request.action === 'stopAutoHedge') {
            stopAutoHedge();
            return;
        }

        const { lighterTab, variationalTab } = await findTradingTabs();
        
        if (request.action === 'getInfo') {
            let lighterData = null, variationalData = null;
            let lighterPortfolioValue = '0', variationalPortfolioValue = '0';
            try {
                if(lighterTab) {
                    const [positions, value] = await Promise.all([executeOnTab(lighterTab.id, 'lighter.js', 'getPositions', [request.coin]), executeOnTab(lighterTab.id, 'lighter.js', 'getPortfolioValue')]);
                    if(positions) lighterData = positions.find(p => p.coin === request.coin);
                    lighterPortfolioValue = value;
                }
                if(variationalTab) {
                    const [positions, value] = await Promise.all([executeOnTab(variationalTab.id, 'variational.js', 'getPositions', [request.coin]), executeOnTab(variationalTab.id, 'variational.js', 'getPortfolioValue')]);
                    if(positions) variationalData = positions.find(p => p.coin === request.coin);
                    variationalPortfolioValue = value;
                }
            } catch (error) { console.error("정보 수집 오류:", error); }
            chrome.runtime.sendMessage({ action: 'updateDisplay', lighterData, variationalData, lighterPortfolioValue, variationalPortfolioValue });
        
        } else if (request.action === 'executeHedgeOrder') {
            if (lighterTab) {
                if (request.orderbookIndex === 'X') {
                    await executeOnTab(lighterTab.id, 'lighter.js', 'clickMarketButton');
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                await executeOnTab(lighterTab.id, 'lighter.js', 'selectOrderType', [request.lighterOrder]);
                await new Promise(resolve => setTimeout(resolve, 150));
                if (request.orderbookIndex !== 'X') {
                    const index = parseInt(request.orderbookIndex, 10);
                    await executeOnTab(lighterTab.id, 'lighter.js', 'clickOrderBookPrice', [request.lighterOrder, index]);
                }
            }
            if (variationalTab) await executeOnTab(variationalTab.id, 'variational.js', 'selectOrderType', [request.variationalOrder]);
        
        } else if (request.action === 'updateOrderbookPrice') {
            if (lighterTab && request.orderbookIndex !== 'X') {
                const index = parseInt(request.orderbookIndex, 10);
                await executeOnTab(lighterTab.id, 'lighter.js', 'clickOrderBookPrice', [request.lighterOrder, index]);
            }
        
        } else if (request.action === 'setQuantity') {
            if (lighterTab) executeOnTab(lighterTab.id, 'lighter.js', 'setQuantity', [request.quantity]);
            if (variationalTab) executeOnTab(variationalTab.id, 'variational.js', 'setQuantity', [request.quantity]);
        
        } else if (request.action === 'submitOrder') {
            if (lighterTab) executeOnTab(lighterTab.id, 'lighter.js', 'clickSubmitButton');
            if (variationalTab) executeOnTab(variationalTab.id, 'variational.js', 'clickSubmitButton');
        
        } else if (request.action === 'submitLighter') {
            if (lighterTab) executeOnTab(lighterTab.id, 'lighter.js', 'clickSubmitButton');
        
        } else if (request.action === 'submitVariational') {
            if (variationalTab) executeOnTab(variationalTab.id, 'variational.js', 'clickSubmitButton');
        
        } else if (request.action === 'setCoin') {
            if (lighterTab) chrome.tabs.update(lighterTab.id, { url: `https://app.lighter.xyz/trade/${request.coin}` });
            if (variationalTab) chrome.tabs.update(variationalTab.id, { url: `https://omni.variational.io/perpetual/${request.coin}` });
        }
    })();
    return true; 
});