// https://omni.variational.io/perpetual/BTC
// BTC 예시

/**
 * 웹페이지의 'Size' 입력 필드에 원하는 수량을 입력하는 스크립트.
 * (React 등 최신 프레임워크 호환 방식)
 * 이 코드를 Chrome 개발자 도구 (F12)의 Console 탭에서 실행할 것.
 * @param {string} quantity 입력할 수량 (예: '0.001', '50.5')
 */
function setQuantity(quantity) {
    // 첫 번째 사이트의 셀렉터: data-testid="quantity-input"
    const inputField = document.querySelector('[data-testid="quantity-input"]');

    if (!inputField) {
        console.error("오류: data-testid='quantity-input'을 가진 입력 필드를 찾을 수 없음.");
        return;
    }

    // --- React와 같은 최신 프레임워크를 위한 가장 확실한 방법 ---
    // 1. HTMLInputElement의 네이티브 'value' setter 함수를 가져옴.
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    
    if (!nativeInputValueSetter) {
        console.error("오류: 네이티브 value setter를 찾을 수 없음.");
        return;
    }

    // 2. 네이티브 setter를 사용하여 inputField의 값을 강제로 설정.
    nativeInputValueSetter.call(inputField, quantity);

    // 3. 'input' 이벤트를 생성하고 dispatch하여 React가 값 변경을 감지하고
    //    내부 상태(state)를 업데이트하도록 함.
    const inputEvent = new Event('input', { bubbles: true });
    inputField.dispatchEvent(inputEvent);

    console.log(`성공: 수량 입력 필드에 '${quantity}'가 입력되었고, 프레임워크 상태 업데이트를 시도했음.`);
}

/**
 * 'Buy' 또는 'Sell' 버튼을 선택하여 클릭하는 함수.
 * @param {string} type 'buy' 또는 'sell'을 입력.
 */
function selectOrderType(type) {
    if (type.toLowerCase() !== 'buy' && type.toLowerCase() !== 'sell') {
        console.error("오류: type은 'buy' 또는 'sell'이어야 함.");
        return;
    }

    const switchContainer = document.querySelector('[role="switch"]');
    if (!switchContainer) {
        console.error("오류: Buy/Sell 전환 컨테이너('[role=\"switch\"]')를 찾을 수 없음.");
        return;
    }

    const buttons = Array.from(switchContainer.querySelectorAll('button'));
    const targetButton = buttons.find(button => button.innerText.toLowerCase().startsWith(type.toLowerCase()));

    if (targetButton) {
        targetButton.click();
        console.log(`성공: '${type}' 버튼을 클릭했음.`);
    } else {
        console.error(`오류: '${type}' 버튼을 찾을 수 없음.`);
    }
}

/**
 * 최종 제출 버튼 (예: 'Buy BTC')을 클릭하는 함수.
 */
function clickSubmitButton() {
    const submitButton = document.querySelector('[data-testid="submit-button"]');
    if (submitButton) {
        submitButton.click();
        console.log("성공: 제출 버튼을 클릭했음.");
    } else {
        console.error("오류: 제출 버튼('[data-testid=\"submit-button\"]')을 찾을 수 없음.");
    }
}

function getPositions(coinFilter = null) {
    let positions = [];
    let layoutMode = 'unknown';

    // 1. Svelte 레이아웃 (새 사이트) 시도
    let positionRows = document.querySelectorAll('div[data-testid="positions-table-row"]');
    if (positionRows.length > 0) {
        layoutMode = 'svelte';
    } else {
        // 2. <table> 레이아웃 (기존 사이트 넓은 화면) 시도
        positionRows = document.querySelectorAll('tbody tr[data-testid^="row-"]');
        if (positionRows.length > 0) {
            layoutMode = 'table';
        } else {
            // 3. <div> 레이아웃 (기존 사이트 좁은 화면) 시도
            positionRows = document.querySelectorAll('div[data-index]');
            if (positionRows.length > 0) {
                layoutMode = 'div';
            }
        }
    }

    // 4. 공통 파싱 로직 실행
    if (layoutMode === 'unknown' || positionRows.length === 0) {
        console.log("포지션 목록을 찾을 수 없음. (관련 DOM 요소를 찾지 못함)");
        return positions; // 빈 배열 반환
    }

    console.log(`레이아웃 감지됨: ${layoutMode.toUpperCase()}`);

    positionRows.forEach((row, index) => {
        try {
            let coinName = null;
            let positionSize = null;
            let unrealizedPnl = null; // PnL 변수 추가
            let funding = null; // Funding 변수 추가

            // --- SVELTE layout parsing ---
            if (layoutMode === 'svelte') {
                const cells = row.querySelectorAll(':scope > div'); // 직계 자식 div (컬럼)
                if (cells.length < 9) { // Funding은 9번째(index 8) 셀
                    console.warn(`행 ${index}: 셀 구조가 예상과 다름 (9개 미만).`);
                    return;
                }
                
                const coinSpan = cells[0].querySelector('span[title$="-PERP"]');
                if (!coinSpan) {
                    console.warn(`행 ${index}: 코인 이름 span을 찾을 수 없음.`);
                    return;
                }
                
                coinName = coinSpan.getAttribute('title').replace('-PERP', '').trim();
                positionSize = cells[1].textContent.trim(); // 2번째 셀
                
                // PnL (8번째 셀, index 7)
                const pnlCell = cells[7];
                const pnlSpan = pnlCell.querySelector('span.text-ellipsis'); // <span class="text-ellipsis overflow-hidden">-$4.03</span>
                if (pnlSpan) {
                    unrealizedPnl = pnlSpan.textContent.trim();
                } else {
                    console.warn(`행 ${index} (${coinName}): PnL span을 찾을 수 없음.`);
                    unrealizedPnl = 0;
                }

                // Funding
                const fundingCell = cells[6];
                funding = fundingCell.textContent.trim();
                if (!funding) {
                    console.warn(`행 ${index} (${coinName}): Funding 값을 찾을 수 없음.`);
                    funding = 0;
                }


            } 

            // --- 필터링 로직 ---
            if (coinFilter && coinName.toUpperCase() !== coinFilter.toUpperCase()) {
                return; // 다음 행으로 넘어감
            }

            // --- 공통 로직: 결과 포맷팅 ---
            if (coinName && positionSize && unrealizedPnl && funding) {
                positions.push({
                    coin: coinName,
                    position: positionSize,
                    pnl: unrealizedPnl, // PnL 추가
                    funding: funding // Funding 추가
                });
            }

        } catch (e) {
            console.error(`행 ${index} (${layoutMode}) 파싱 중 오류 발생:`, e, row);
        }
    });

    // 5. 최종 결과 출력
    if (positions.length > 0) {
        if (coinFilter) {
            console.log(`--- 현재 포지션 (${coinFilter.toUpperCase()}만) ---`);
        } else {
            console.log("--- 현재 포지션 (전체) ---");
        }
        console.table(positions);
    } else {
        if (coinFilter) {
            console.log(`'${coinFilter}' 포지션을 찾을 수 없음.`);
        } else {
            console.log("파싱된 포지션이 없음.");
        }
    }

    // 6. 파싱된 결과를 배열로 반환
    return positions;
}

/**
 * 페이지 상단의 포트폴리오 가치를 가져와서 출력하고 반환하는 함수.
 * @returns {string | null} 포트폴리오 가치 (예: "$12,019.10") 또는 찾지 못할 경우 null.
 */
function getPortfolioValue() {
    // 1. data-testid="portfolio-summary"를 가진 컨테이너를 찾음
    const portfolioContainer = document.querySelector('[data-testid="portfolio-summary"]');
    
    if (!portfolioContainer) {
        console.error("오류: 포트폴리오 컨테이너('[data-testid=\"portfolio-summary\"]')를 찾을 수 없음.");
        return null;
    }

    try {
        // 2. 컨테이너 내부의 첫 번째 'flex-col' div를 찾음 (Portfolio 섹션)
        const portfolioSection = portfolioContainer.querySelector('div.flex-col');
        
        if (!portfolioSection) {
            console.error("오류: 포트폴리오 섹션(div.flex-col)을 찾을 수 없음.");
            return null;
        }

        // 3. Portfolio 섹션 안에서 값을 담고 있는 span을 찾음
        // (예: <span class="...tabular-nums...">...</span>)
        const valueSpan = portfolioSection.querySelector('div > span.tabular-nums');
        
        if (!valueSpan) {
            console.error("오류: 포트폴리오 값(span.tabular-nums)을 찾을 수 없음.");
            return null;
        }

        const portfolioValue = valueSpan.textContent.trim();
        console.log(`포트폴리오 가치: ${portfolioValue}`);
        return portfolioValue;

    } catch (e) {
        console.error("포트폴리오 값 파싱 중 오류 발생:", e);
        return null;
    }
}

window.setQuantity = setQuantity;
window.selectOrderType = selectOrderType;
window.clickSubmitButton = clickSubmitButton;
window.getPositions = getPositions; // getPositions 함수를 window에 할당 (추가된 부분)
window.getPortfolioValue = getPortfolioValue;
