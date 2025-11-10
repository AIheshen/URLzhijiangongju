(function() {
    'use strict';

    // =================================================================
    // 全局变量和常量
    // =================================================================
    const PREFIX = 'uqia-'; // **【优化1】** 定义唯一前缀，防止冲突
    let panel;
    let isMouseDown = false, isDragging = false, startX, startY, initialLeft, initialTop, currentX, currentY, animationFrameId = null;
    const dragThreshold = 5;
    let extractedData = []; 
    let markedSeqs = [];  

    const STORAGE_KEYS = {
        position: 'urlInspectorPanelPosition_v2', // 更新存储键以避免与旧版冲突
        minimized: 'urlInspectorPanelMinimized_v2'
    };

    // =================================================================
    // 辅助函数 (存储, 通知)
    // =================================================================
    function saveMinimizedState(isMinimized) { localStorage.setItem(STORAGE_KEYS.minimized, isMinimized); }
    function getMinimizedState() { return localStorage.getItem(STORAGE_KEYS.minimized) === 'true'; }
    function savePanelPosition(left, top) { localStorage.setItem(STORAGE_KEYS.position, JSON.stringify({ left, top })); }
    function getPanelPosition() { const stored = localStorage.getItem(STORAGE_KEYS.position); return stored ? JSON.parse(stored) : { left: window.innerWidth - 340, top: 40 }; }
    
    function showNotification(message, isError = false) {
        let notification = document.getElementById(`${PREFIX}notification`);
        if (!notification) {
            notification = document.createElement('div');
            notification.id = `${PREFIX}notification`;
            notification.style.cssText = `
                position:fixed; top:20px; right:20px; background: ${isError ? '#e74c3c' : '#27ae60'}; color: white;
                padding:10px 15px; border-radius:6px; z-index:100500; transition: opacity 0.3s, transform 0.3s;
                font-size:14px; font-weight:bold; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform: translateX(120%);
            `;
            document.body.appendChild(notification);
        }
        notification.textContent = message;
        setTimeout(() => { notification.style.transform = 'translateX(0)'; }, 10);
        setTimeout(() => { notification.style.transform = 'translateX(120%)'; setTimeout(() => notification.remove(), 400); }, 3000); // 稳定增强：动画结束后移除元素
    }

    // =================================================================
    // 核心功能逻辑
    // =================================================================
    function extractUrlsFromPage() {
        const selector = 'textarea.ct-ant-input';
        const urlInputs = document.querySelectorAll(selector);
        const allData = [];

        urlInputs.forEach(input => {
            const row = input.closest('tr');
            if (!row) return;

            const seqTd = row.querySelector('td:first-child');
            const seq = seqTd ? seqTd.textContent.trim() : 'N/A';
            const url = input.value.trim();
            
            if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                allData.push({ seq: seq, url: url });
            }
        });
        
        extractedData = allData;
        markedSeqs = []; 
        updateUI();
        updateRemarkOutput(); 
        
        if (extractedData.length > 0) { showNotification(`提取成功！共发现 ${extractedData.length} 个链接。`); } 
        else { showNotification('未在表格中找到任何有效链接。', true); }
    }
    
    function openAllUrls() {
        if (extractedData.length === 0) { 
            showNotification('链接列表为空，请先提取URL。', true); 
            return; 
        }
        
        const urlsToOpen = extractedData.map(item => item.url);
        
        chrome.runtime.sendMessage({ action: 'openUrls', urls: urlsToOpen }, response => {
            if (chrome.runtime.lastError) {
                showNotification(`通信错误: ${chrome.runtime.lastError.message}`, true); return;
            }
            if (response && response.status === 'completed') {
                showNotification(`在侧边新窗口中打开 ${response.count} 个链接...`);
            } else {
                showNotification(`打开链接时发生错误: ${response ? response.message : '未知'}`, true);
            }
        });
    }
    
    function closeOpenedTabs() {
        showNotification('正在发送关闭指令...');
        chrome.runtime.sendMessage({ action: 'closeOpenedTabs' }, response => {
            if (chrome.runtime.lastError) {
                showNotification(`通信错误: ${chrome.runtime.lastError.message}`, true); return;
            }
            if (response && response.status === 'closed') {
                showNotification(`操作成功！已关闭 ${response.count} 个标签页。`);
                extractedData = [];
                markedSeqs = [];
                updateUI();
                updateRemarkOutput();
            } else if (response && response.status === 'no_tabs_to_close') {
                showNotification('没有由本插件打开的标签页需要关闭。', true);
            }
        });
    }

    // =================================================================
    // UI 更新与创建
    // =================================================================
    function updateUI() {
        const counter = document.getElementById(`${PREFIX}url-counter`);
        const urlList = document.getElementById(`${PREFIX}url-list`);
        
        if (counter) { counter.textContent = `已提取 ${extractedData.length} 个链接`; }
        if (urlList) {
            urlList.innerHTML = '';
            if (extractedData.length > 0) {
                extractedData.forEach((item, index) => {
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <span class="${PREFIX}url-seq">${item.seq}</span>
                        <span class="${PREFIX}url-text" title="${item.url}">${item.url}</span>
                        <button class="${PREFIX}mark-btn" data-seq="${item.seq}">标记</button>
                    `;
                    urlList.appendChild(li);
                });
            } else {
                urlList.innerHTML = `<li class="${PREFIX}empty-list">暂无链接</li>`;
            }
        }
    }
    
    function updateRemarkOutput() {
        const outputText = document.getElementById(`${PREFIX}remark-result-text`);
        const copyBtn = document.getElementById(`${PREFIX}copy-remark-btn`);
        const reasonSelect = document.getElementById(`${PREFIX}remark-reason-select`);

        if (outputText && copyBtn && reasonSelect) {
            if (markedSeqs.length > 0) {
                const sortedSeqs = markedSeqs.sort((a, b) => {
                    const numA = parseInt(a.replace('#', '').replace('.', ''));
                    const numB = parseInt(b.replace('#', '').replace('.', ''));
                    return numA - numB;
                });
                
                const reason = reasonSelect.value;
                // **【优化3】** 根据下拉框选择生成不同格式的输出
                if (reason === '无') {
                    outputText.textContent = sortedSeqs.join(' ');
                } else {
                    outputText.textContent = `${sortedSeqs.join(' ')} ${reason}`;
                }
                
                copyBtn.style.display = 'inline-block';
            } else {
                outputText.textContent = '';
                copyBtn.style.display = 'none';
            }
        }
    }
    
    function handleMarkButtonClick(event) {
        const target = event.target;
        if (target.classList.contains(`${PREFIX}mark-btn`)) {
            const seq = target.dataset.seq;
            const index = markedSeqs.indexOf(seq);
            
            // **【功能增强】** 允许取消标记
            if (index === -1) {
                markedSeqs.push(seq);
                target.disabled = true;
                target.textContent = '已标记';
            }
            updateRemarkOutput();
        }
    }
    
    function handleCopyRemark() {
        const textToCopy = document.getElementById(`${PREFIX}remark-result-text`).textContent;
        if (textToCopy) {
            navigator.clipboard.writeText(textToCopy).then(() => {
                showNotification('已复制标记结果');
            }).catch(err => {
                showNotification('复制失败!', true);
            });
        }
    }

    function createControlPanel() {
        if (document.getElementById(`${PREFIX}url-inspector-panel`)) return;
        
        const storedPosition = getPanelPosition();
        const isMinimized = getMinimizedState();
        panel = document.createElement('div');
        panel.id = `${PREFIX}url-inspector-panel`;
        panel.style.cssText = `position:fixed; z-index:10001; left: ${storedPosition.left}px; top: ${storedPosition.top}px;`;
        
        // **【优化1 & 3】** 更新所有ID和Class，并修改下拉框选项
        panel.innerHTML = `
            <div id="${PREFIX}panel-header">
                <span class="${PREFIX}panel-icon">🐼</span>
                <span class="${PREFIX}panel-title">URL质检助手</span>
            </div>
            <div id="${PREFIX}main-content">
                <div id="${PREFIX}controls">
                    <button id="${PREFIX}extract-urls-btn" title="从当前页面的表格中提取所有URL">提取表格URL</button>
                    <button id="${PREFIX}open-urls-btn" title="在屏幕另一侧打开所有链接，不影响当前窗口">侧边窗口打开</button>
                </div>
                <button id="${PREFIX}close-tabs-btn" title="关闭刚才通过“侧边窗口打开”创建的所有标签页">一键关闭刚才打开的</button>
                <div id="${PREFIX}url-list-container">
                    <strong id="${PREFIX}url-counter">已提取 0 个链接</strong>
                    <ul id="${PREFIX}url-list"><li class="${PREFIX}empty-list">暂无链接</li></ul>
                </div>
                <div id="${PREFIX}remarks-output-container">
                    <div class="${PREFIX}remark-controls">
                        <strong>标记理由:</strong>
                        <select id="${PREFIX}remark-reason-select">
                            <option value="有效内容过少">有效内容过少</option>
                            <option value="为无效链接">为无效链接</option>
                            <option value="属于外链">属于外链</option>
                            <option value="无">无</option>
                        </select>
                    </div>
                    <div id="${PREFIX}remark-output-area">
                        <span id="${PREFIX}remark-result-text"></span>
                        <button id="${PREFIX}copy-remark-btn" title="点击复制">复制</button>
                    </div>
                </div>
            </div>
        `;
        
        if (isMinimized) { panel.classList.add('minimized'); }
        document.body.appendChild(panel);

        // 绑定事件
        document.getElementById(`${PREFIX}extract-urls-btn`).addEventListener('click', extractUrlsFromPage);
        document.getElementById(`${PREFIX}open-urls-btn`).addEventListener('click', openAllUrls);
        document.getElementById(`${PREFIX}close-tabs-btn`).addEventListener('click', closeOpenedTabs);
        document.getElementById(`${PREFIX}url-list`).addEventListener('click', handleMarkButtonClick);
        document.getElementById(`${PREFIX}remark-reason-select`).addEventListener('change', updateRemarkOutput);
        document.getElementById(`${PREFIX}copy-remark-btn`).addEventListener('click', handleCopyRemark);
        
        const header = document.getElementById(`${PREFIX}panel-header`);
        
        // 点击与拖动逻辑
        header.addEventListener('click', () => { if (isDragging) return; panel.classList.toggle('minimized'); saveMinimizedState(panel.classList.contains('minimized')); });
        
        // **【优化2】** 丝滑拖动逻辑 (保持原有优秀实现)
        const updatePosition = () => { panel.style.transform = `translate3d(${currentX - panel.offsetLeft}px, ${currentY - panel.offsetTop}px, 0)`; animationFrameId = null; };
        
        header.addEventListener('mousedown', e => {
            isMouseDown = true; 
            isDragging = false;
            startX = e.clientX; 
            startY = e.clientY;
            initialLeft = panel.offsetLeft;
            initialTop = panel.offsetTop;
            panel.style.transition = 'none'; // 拖动时移除过渡效果
        });

        document.addEventListener('mousemove', e => { 
            if (!isMouseDown) return; 
            
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (!isDragging && (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold)) { 
                isDragging = true; 
                document.body.style.userSelect = 'none'; // 防止拖动时选中文本
            } 
            
            if (isDragging) { 
                currentX = initialLeft + dx;
                currentY = initialTop + dy;
                if (!animationFrameId) { 
                    animationFrameId = requestAnimationFrame(() => {
                        panel.style.left = `${currentX}px`;
                        panel.style.top = `${currentY}px`;
                        animationFrameId = null;
                    });
                } 
            } 
        });
        
        document.addEventListener('mouseup', () => { 
            if (!isMouseDown) return; 
            isMouseDown = false; 
            document.body.style.userSelect = ''; 
            panel.style.transition = ''; // 恢复过渡效果
            
            if (isDragging) { 
                savePanelPosition(panel.offsetLeft, panel.offsetTop); 
            }
            
            setTimeout(() => { isDragging = false; }, 0); // 延迟重置拖动状态，以完成click事件的判断
        });
    }

    // =================================================================
    // 初始化
    // =================================================================
    function init() {
        console.log('🐼 URL质检助手已启动 (v3.0 - 全面优化版)');
        createControlPanel();
    }

    if (document.readyState === 'loading') { 
        document.addEventListener('DOMContentLoaded', init); 
    } else { 
        init(); 
    }
})();