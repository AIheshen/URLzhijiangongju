// background.js (v3.2 - 最终稳定版)

// 使用 chrome.storage.session 在整个浏览器会话中持久化存储标签页ID
// 这是解决“后台脚本休眠导致数据丢失”问题的关键
const STORAGE_KEY = 'managedTabIds_v2';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // --- 打开URL的请求 ---
  if (request.action === 'openUrls' && request.urls && request.urls.length > 0) {
    // 异步处理，必须返回 true
    (async () => {
      try {
        const senderWindow = await chrome.windows.get(sender.tab.windowId);
        const displays = await chrome.system.display.getInfo();
        const primaryDisplay = displays.find(d => d.isPrimary) || displays[0];
        
        const screenWidth = primaryDisplay.workArea.width;
        const screenHeight = primaryDisplay.workArea.height;
        const newWindowWidth = Math.round(screenWidth / 2);
        const newWindowHeight = screenHeight;
        const newWindowTop = primaryDisplay.workArea.top;
        
        // 决定新窗口在左边还是右边
        let newWindowLeft = (senderWindow.left < screenWidth / 2) 
          ? (screenWidth - newWindowWidth) 
          : primaryDisplay.workArea.left;
        
        const newWindow = await chrome.windows.create({
          url: request.urls,
          left: newWindowLeft,
          top: newWindowTop,
          width: newWindowWidth,
          height: newWindowHeight,
          focused: false,
          state: "normal"
        });
        
        if (!newWindow || !newWindow.tabs) {
          throw new Error("创建新窗口失败。");
        }
        
        const openedTabIds = newWindow.tabs.map(tab => tab.id);
        // 【关键优化1】将ID保存到 session storage，确保数据持久性
        await chrome.storage.session.set({ [STORAGE_KEY]: openedTabIds });
        
        console.log('已在新窗口打开并持久化记录IDs:', openedTabIds);
        sendResponse({ status: 'completed', count: openedTabIds.length });

      } catch (error) {
        console.error("创建窗口时发生错误:", error);
        sendResponse({ status: 'error', message: error.message });
      }
    })();
    return true; // 声明将进行异步响应
  }

  // --- 关闭URL的请求 ---
  if (request.action === 'closeOpenedTabs') {
    (async () => {
      // 【关键优化2】从 session storage 读取ID，数据永不丢失
      const data = await chrome.storage.session.get(STORAGE_KEY);
      const idsToClose = data[STORAGE_KEY] || [];
      
      if (idsToClose.length === 0) {
        sendResponse({ status: 'no_tabs_to_close' });
        return;
      }
      
      let closedCount = 0;
      // 【关键优化3】使用 for 循环逐个关闭，一个失败不影响其他
      for (const tabId of idsToClose) {
        try {
          // 尝试关闭，即使失败（如已手动关闭）也不会抛出错误中断循环
          await chrome.tabs.remove(tabId);
          closedCount++;
        } catch (error) {
          // 这里的错误是预料之中的，比如标签页已不存在。
          // 我们只需要静默处理，让循环继续即可。
          // console.log(`标签页 ${tabId} 关闭失败 (可能已关闭):`, error.message);
        }
      }
      
      // 清理存储
      await chrome.storage.session.remove(STORAGE_KEY);
      
      console.log(`关闭指令完成，成功关闭 ${closedCount} 个标签页。`);
      sendResponse({ status: 'closed', count: closedCount });

    })();
    return true; // 声明将进行异步响应
  }
});