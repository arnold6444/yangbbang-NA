document.addEventListener('DOMContentLoaded', async () => {
    // --- UI 요소 가져오기 ---
    const coinSymbolInput = document.getElementById('coinSymbol');
    const setCoinBtn = document.getElementById('setCoinBtn');
    const quantityInput = document.getElementById('quantity');
    const lBuyVSellBtn = document.getElementById('lBuyVSell');
    const lSellVBuyBtn = document.getElementById('lSellVBuy');
    const orderbookIndexInput = document.getElementById('orderbookIndex');
    const submitOrderBtn = document.getElementById('submitOrder');
    const submitLighterBtn = document.getElementById('submitLighter');
    const submitVariationalBtn = document.getElementById('submitVariational');

    const priceRefreshIntervalInput = document.getElementById('priceRefreshInterval');
    const autoPriceUpdateToggleBtn = document.getElementById('autoPriceUpdateToggle');
    
    const autoLimitHedgeBtn = document.getElementById('autoLimitHedgeBtn');
    const deltaThresholdInput = document.getElementById('deltaThreshold');
    const hedgeIntervalInput = document.getElementById('hedgeInterval');
    const lockTimeoutInput = document.getElementById('lockTimeout');
    const autoHedgeStatusP = document.getElementById('autoHedgeStatus');

    const lighterSizeCell = document.getElementById('lighter-size');
    const lighterPnlCell = document.getElementById('lighter-pnl');
    const lighterFundingCell = document.getElementById('lighter-funding');
    const variationalSizeCell = document.getElementById('variational-size');
    const variationalPnlCell = document.getElementById('variational-pnl');
    const variationalFundingCell = document.getElementById('variational-funding');
    const lighterBalanceCell = document.getElementById('lighter-balance');
    const variationalBalanceCell = document.getElementById('variational-balance');
    const totalBalanceCell = document.getElementById('total-balance');

    let positionInterval;
    let autoPriceUpdateInterval = null; 
    let currentOrderType = null; 

    // --- 설정 저장/불러오기 로직 (추가된 부분) ---
    const SETTING_IDS = [
        'coinSymbol', 'quantity', 'orderbookIndex', 'priceRefreshInterval',
        'deltaThreshold', 'hedgeInterval', 'lockTimeout'
    ];

    async function loadSettings() {
        const settings = await chrome.storage.local.get(SETTING_IDS);
        SETTING_IDS.forEach(id => {
            const element = document.getElementById(id);
            if (element && settings[id] !== undefined) {
                element.value = settings[id];
            }
        });
        console.log('Settings loaded:', settings);
    }

    function saveSetting(key, value) {
        chrome.storage.local.set({ [key]: value });
    }

    // 설정 불러오기 실행
    await loadSettings();
    // 설정 값 변경 시 자동 저장 리스너 추가
    SETTING_IDS.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            const eventType = element.tagName === 'SELECT' ? 'change' : 'input';
            element.addEventListener(eventType, () => {
                saveSetting(id, element.value);
            });
        }
    });

    // --- 포매팅 함수들 ---
    function formatSize(value) { const num = parseFloat(value); return isNaN(num) ? '0.0000' : num.toFixed(4); }
    function formatPnlAndFunding(value) { const num = parseFloat(String(value).replace(/[^0-9.-]/g, '')); return isNaN(num) ? '0.0' : num.toFixed(1); }
    function parseCurrency(value) { if (!value || typeof value !== 'string') return 0; return parseFloat(value.replace(/[^0-9.-]/g, '')); }
    function formatCurrency(num) { if (isNaN(num)) return '$0.00'; return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
    
    // --- 데이터 요청 및 자동 갱신 ---
    function requestData() {
        const coin = coinSymbolInput.value.trim().toUpperCase() || 'BTC';
        chrome.runtime.sendMessage({ action: 'getInfo', coin: coin });
    }
    positionInterval = setInterval(requestData, 1000);
    window.addEventListener('unload', () => { 
        if (positionInterval) clearInterval(positionInterval);
        if (autoPriceUpdateInterval) clearInterval(autoPriceUpdateInterval);
        chrome.runtime.sendMessage({ action: 'stopAutoHedge' }); // 팝업 닫히면 모든 자동화 중지
    });

    // --- 백그라운드 메시지 수신 ---
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'updateDisplay') {
            const { lighterData, variationalData, lighterPortfolioValue, variationalPortfolioValue } = request;
            lighterSizeCell.textContent = lighterData ? formatSize(lighterData.position) : '0.0000';
            lighterPnlCell.textContent = lighterData ? formatPnlAndFunding(lighterData.pnl) : '0.0';
            lighterFundingCell.textContent = lighterData ? formatPnlAndFunding(lighterData.funding) : '0.0';
            variationalSizeCell.textContent = variationalData ? formatSize(variationalData.position) : '0.0000';
            variationalPnlCell.textContent = variationalData ? formatPnlAndFunding(variationalData.pnl) : '0.0';
            variationalFundingCell.textContent = variationalData ? formatPnlAndFunding(variationalData.funding) : '0.0';
            const lValue = parseCurrency(lighterPortfolioValue);
            const vValue = parseCurrency(variationalPortfolioValue);
            lighterBalanceCell.textContent = formatCurrency(lValue);
            variationalBalanceCell.textContent = formatCurrency(vValue);
            totalBalanceCell.textContent = formatCurrency(lValue + vValue);
        } else if (request.action === 'updateAutoHedgeStatus') {
            autoHedgeStatusP.textContent = `Status: ${request.status}`;
            if (request.status === 'Idle' || request.status.startsWith('Error')) {
                autoLimitHedgeBtn.textContent = 'Auto limit L -> market V';
                autoLimitHedgeBtn.classList.remove('active');
            } else {
                autoLimitHedgeBtn.textContent = 'STOP Auto HEDGE';
                autoLimitHedgeBtn.classList.add('active');
            }
            if(request.originalQuantity) {
                quantityInput.value = request.originalQuantity;
            }
        }
    });

    // --- 자동 가격 업데이트 로직 ---
    function startAutoPriceUpdate() {
        const orderbookIndex = orderbookIndexInput.value;
        const interval = parseInt(priceRefreshIntervalInput.value) || 200;
        if (orderbookIndex === 'X' || !currentOrderType) {
            alert('Please select an orderbook index (not X) and a direction (L-Buy/V-Sell or L-Sell/V-Buy) first.');
            return;
        }
        stopAutoPriceUpdate();
        autoPriceUpdateInterval = setInterval(() => {
            chrome.runtime.sendMessage({ 
                action: 'updateOrderbookPrice',
                lighterOrder: currentOrderType,
                orderbookIndex: orderbookIndexInput.value // 최신 값 사용
            });
        }, interval);
        autoPriceUpdateToggleBtn.textContent = 'Stop';
        autoPriceUpdateToggleBtn.classList.add('active');
    }
    function stopAutoPriceUpdate() {
        if (autoPriceUpdateInterval) {
            clearInterval(autoPriceUpdateInterval);
            autoPriceUpdateInterval = null;
        }
        autoPriceUpdateToggleBtn.textContent = 'Start';
        autoPriceUpdateToggleBtn.classList.remove('active');
    }

    // --- 자동 헤지 로직 ---
    autoLimitHedgeBtn.addEventListener('click', () => {
        if (autoLimitHedgeBtn.classList.contains('active')) {
            chrome.runtime.sendMessage({ action: 'stopAutoHedge' });
        } else {
            // L-Buy/L-Sell 버튼을 눌러 currentOrderType이 설정되었는지 확인
            // 이 값은 이제 직접 사용되지 않지만, 사용자가 방향을 인지했다는 확인용으로 사용
            if (!currentOrderType) {
                alert('Please select a hedging direction first (L-Buy/V-Sell or L-Sell/V-Buy).');
                return;
            }
            chrome.runtime.sendMessage({
                action: 'startAutoHedge',
                coin: coinSymbolInput.value.trim().toUpperCase() || 'BTC',
                originalQuantity: quantityInput.value,
                delta: parseFloat(deltaThresholdInput.value),
                interval: parseInt(hedgeIntervalInput.value, 10),
                lockTimeout: parseInt(lockTimeoutInput.value, 10) * 1000
            });
        }
    });

    // --- 나머지 이벤트 리스너들 ---
    autoPriceUpdateToggleBtn.addEventListener('click', () => {
        autoPriceUpdateInterval ? stopAutoPriceUpdate() : startAutoPriceUpdate();
    });
    orderbookIndexInput.addEventListener('change', () => {
        if (orderbookIndexInput.value === 'X') stopAutoPriceUpdate();
    });
    quantityInput.addEventListener('input', (e) => { 
        if (e.target.value) chrome.runtime.sendMessage({ action: 'setQuantity', quantity: e.target.value }); 
    });
    setCoinBtn.addEventListener('click', () => {
        const coin = coinSymbolInput.value.trim().toUpperCase();
        if (coin) {
            chrome.runtime.sendMessage({ action: 'setCoin', coin: coin });
            setTimeout(requestData, 1000);
        }
    });
    lBuyVSellBtn.addEventListener('click', () => {
        currentOrderType = 'buy';
        chrome.runtime.sendMessage({ action: 'executeHedgeOrder', lighterOrder: 'buy', variationalOrder: 'sell', orderbookIndex: orderbookIndexInput.value });
        if (orderbookIndexInput.value !== 'X' && autoPriceUpdateInterval) startAutoPriceUpdate();
    });
    lSellVBuyBtn.addEventListener('click', () => {
        currentOrderType = 'sell';
        chrome.runtime.sendMessage({ action: 'executeHedgeOrder', lighterOrder: 'sell', variationalOrder: 'buy', orderbookIndex: orderbookIndexInput.value });
        if (orderbookIndexInput.value !== 'X' && autoPriceUpdateInterval) startAutoPriceUpdate();
    });
    submitOrderBtn.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'submitOrder' }));
    submitLighterBtn.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'submitLighter' }));
    submitVariationalBtn.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'submitVariational' }));
});