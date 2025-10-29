// https://app.lighter.xyz/trade/BTC (BTC 예시)

function setQuantity(quantity) {
    const inputField = document.querySelector('[data-testid="quantity-input"], [data-testid="place-order-size-input"]');
    if (!inputField) {
        console.error("오류: 수량 입력 필드를 찾을 수 없음.");
        return;
    }
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    if (!nativeInputValueSetter) {
        console.error("오류: 네이티브 value setter를 찾을 수 없음.");
        return;
    }
    nativeInputValueSetter.call(inputField, quantity);
    const inputEvent = new Event('input', { bubbles: true });
    inputField.dispatchEvent(inputEvent);
    console.log(`성공: 수량 입력 필드에 '${quantity}'가 입력됨.`);
}

function selectOrderType(type) {
    if (type.toLowerCase() !== 'buy' && type.toLowerCase() !== 'sell') {
        console.error("오류: type은 'buy' 또는 'sell'이어야 함.");
        return;
    }
    const maxAttempts = 20;
    let attempt = 0;
    const intervalId = setInterval(() => {
        let targetButton = null;
        if (type.toLowerCase() === 'buy') {
            targetButton = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Buy / Long'));
        } else {
            targetButton = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Sell / Short'));
        }
        if (targetButton) {
            clearInterval(intervalId);
            targetButton.click();
            console.log(`성공: '${targetButton.textContent.trim()}' 버튼 클릭.`);
        } else if (attempt >= maxAttempts) {
            clearInterval(intervalId);
            console.error(`오류: '${type}' 관련 버튼을 찾을 수 없음.`);
        }
        attempt++;
    }, 100);
}

function clickSubmitButton() {
    const submitButton = document.querySelector('[data-testid="submit-button"], [data-testid="place-order-button"]');
    if (submitButton) {
        submitButton.click();
        console.log("성공: 제출 버튼 클릭.");
    } else {
        console.error("오류: 제출 버튼을 찾을 수 없음.");
    }
}

/**
 * Lighter 오더북의 특정 가격을 클릭하는 함수.
 * @param {string} orderType 'buy' 또는 'sell'
 * @param {number} index 사용자가 팝업에서 입력한 인덱스 (0-10)
 */
function clickOrderBookPrice(orderType, index) {
    // comment: 오더북은 0~10까지만 존재하므로 최대값을 10으로 제한
    if (typeof index !== 'number' || index < 0 || index > 10) {
        console.error(`오류: 유효하지 않은 인덱스 값: ${index} (0-10만 허용)`);
        return;
    }

    let targetElement;
    if (orderType === 'buy') {
        const selector = `div[data-testid="ob-bid-${index}"] span[data-testid="price"]`;
        targetElement = document.querySelector(selector);
        if (!targetElement) console.error(`오류: Bid 요소를 찾지 못함. Selector: ${selector}`);
    } else if (orderType === 'sell') {
        // comment: ask는 0~10까지이므로 10에서 빼기로 역순 계산
        const reversedIndex = 10 - index;
        if (reversedIndex < 0 || reversedIndex > 10) {
            console.error(`오류: 계산된 Ask 인덱스 범위 초과: ${index} -> ${reversedIndex}`);
            return;
        }
        const selector = `div[data-testid="ob-ask-${reversedIndex}"] span[data-testid="price"]`;
        targetElement = document.querySelector(selector);
        if (!targetElement) console.error(`오류: Ask 요소를 찾지 못함. Selector: ${selector}`);
    } else {
        console.error(`오류: 알 수 없는 orderType: ${orderType}`);
        return;
    }

    if (targetElement) {
        targetElement.click();
        console.log(`성공: Lighter 오더북 ${orderType} 위치(${index}) 클릭.`);
    }
}

function clickMarketButton() {
    const marketButton = document.querySelector('[data-testid="select-order-type-market"]');
    if (marketButton) {
        marketButton.click();
        console.log("성공: Market 버튼 클릭.");
    } else {
        console.error("오류: Market 버튼을 찾을 수 없음.");
    }
}

function getPositions(coinFilter = null) {
    let positions = [];
    
    // 새로운 <tr> 구조로 변경
    let positionRows = Array.from(document.querySelectorAll('tr[data-testid^="row-"]'));
    
    if (positionRows.length === 0) {
        console.log("포지션을 찾을 수 없음");
        return positions;
    }

    positionRows.forEach((row, index) => {
        try {
            // td 셀들을 가져옴
            const cells = row.querySelectorAll('td');
            if (cells.length < 9) {
                console.warn(`행 ${index}: 셀 구조가 예상과 다름 (9개 미만).`);
                return;
            }

            // 첫 번째 td에서 코인 이름과 방향(long/short) 확인
            const firstCell = cells[0];
            const directionDiv = firstCell.querySelector('[data-testid^="direction-"]');
            if (!directionDiv) {
                console.warn(`행 ${index}: 방향 div를 찾을 수 없음.`);
                return;
            }
            
            const isLong = directionDiv.dataset.testid === 'direction-long';
            const coinNameSpan = firstCell.querySelector('div > span:nth-child(2)');
            if (!coinNameSpan) {
                console.warn(`행 ${index}: 코인 이름을 찾을 수 없음.`);
                return;
            }
            
            const coinName = coinNameSpan.textContent.trim();
            
            // 필터링
            if (coinFilter && coinName.toUpperCase() !== coinFilter.toUpperCase()) {
                return;
            }

            // 두 번째 td에서 포지션 크기
            const sizeCell = cells[1];
            const sizeSpans = sizeCell.querySelectorAll('span');
            const positionSize = sizeSpans[0] ? sizeSpans[0].textContent.trim() : '0';
            
            // 포지션 방향 반영 (short인 경우 음수)
            const finalPosition = isLong ? positionSize : `-${positionSize}`;

            // 7번째 td (index 6)에서 PnL
            const pnlCell = cells[6];
            let unrealizedPnl = '0';
            const pnlDiv = pnlCell.querySelector('div');
            if (pnlDiv) {
                // "$101.50 (3.13%)" 형태에서 금액 부분만 추출
                const pnlText = pnlDiv.textContent.trim();
                const pnlMatch = pnlText.match(/([+-]?\$[\d,]+\.?\d*)/);
                if (pnlMatch) {
                    unrealizedPnl = pnlMatch[1];
                }
            }

            // 9번째 td (index 8)에서 Funding
            const fundingCell = cells[8];
            let funding = '0';
            const fundingDiv = fundingCell.querySelector('div');
            if (fundingDiv) {
                funding = fundingDiv.textContent.trim();
            }

            positions.push({
                coin: coinName,
                position: finalPosition,
                pnl: unrealizedPnl,
                funding: funding
            });

            console.log(`포지션 파싱 성공: ${coinName}, Size: ${finalPosition}, PnL: ${unrealizedPnl}, Funding: ${funding}`);

        } catch (e) {
            console.error(`행 ${index} 파싱 중 오류:`, e);
        }
    });

    return positions;
}

function getPortfolioValue() {
    
    try {
        // 페이지 내의 모든 <p> 태그를 순회
        const allParagraphs = document.querySelectorAll('p');
        let tradingEquityValue = null;

        allParagraphs.forEach(p => {
            if (p.textContent.trim() === 'Trading Equity:') {
                // p 태그를 감싸고 있는 row 컨테이너 (.flex.w-full.justify-between)를 찾음
                const rowContainer = p.closest('.flex.w-full.justify-between');
                if (rowContainer) {
                    // 해당 row 컨테이너 안에서 값을 담고 있는 span을 찾음
                    const valueSpan = rowContainer.querySelector('.tabular-nums span');
                    if (valueSpan) {
                        tradingEquityValue = valueSpan.textContent.trim();
                    }
                }
            }
        });

        if (tradingEquityValue) {
            console.log(`Trading Equity (방법 2): ${tradingEquityValue}`);
            return tradingEquityValue;
        }

        // --- 두 방법 모두 실패 ---
        console.error("오류: 포트폴리오 컨테이너(방법 1) 또는 'Trading Equity:'(방법 2)를 찾을 수 없음.");
        return null;

    } catch (e) {
        console.error("Trading Equity (방법 2) 파싱 중 오류 발생:", e);
        return null;
    }
}

// 모든 함수를 window 객체에 등록
window.setQuantity = setQuantity;
window.selectOrderType = selectOrderType;
window.clickSubmitButton = clickSubmitButton;
window.clickOrderBookPrice = clickOrderBookPrice;
window.clickMarketButton = clickMarketButton;
window.getPositions = getPositions;
window.getPortfolioValue = getPortfolioValue;