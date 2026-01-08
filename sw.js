async function cleanupChildren() {
    const data = await chrome.storage.local.get(['childIds']);

    if (data.childIds) {
        for (const id of data.childIds) {
            try {
                await chrome.windows.remove(id);
            } catch (e) {
                // Window might already be closed
            }
        }
    }
    await chrome.storage.local.remove(['controllerTabId', 'childIds', 'controllerWindowId']);
}

chrome.action.onClicked.addListener(async () => {
    const data = await chrome.storage.local.get(['controllerTabId']);

    if (data.controllerTabId) {
        try {
            const tab = await chrome.tabs.get(data.controllerTabId);
            await chrome.windows.update(tab.windowId, { focused: true });
            await chrome.tabs.update(tab.id, { active: true });
            await chrome.storage.local.set({ controllerWindowId: tab.windowId });
            return;
        } catch (e) {
            // Controller tab doesn't exist anymore
        }
    }

    const tab = await chrome.tabs.create({
        url: 'controller.html',
        active: true
    });

    await chrome.storage.local.set({ controllerTabId: tab.id, controllerWindowId: tab.windowId });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    const data = await chrome.storage.local.get(['controllerTabId']);

    if (tabId === data.controllerTabId) {
        await cleanupChildren();
    }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
    const data = await chrome.storage.local.get(['childIds']);

    if (data.childIds && data.childIds.includes(windowId)) {
        const updatedChildIds = data.childIds.filter(id => id !== windowId);
        await chrome.storage.local.set({ childIds: updatedChildIds });
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const data = await chrome.storage.local.get(['controllerTabId']);
    if (activeInfo.tabId === data.controllerTabId) {
        chrome.runtime.sendMessage({ type: 'bringChildrenToFront', reason: 'tab-activated' });
    }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
    const data = await chrome.storage.local.get(['controllerWindowId']);
    if (windowId !== chrome.windows.WINDOW_ID_NONE &&
        data.controllerWindowId === windowId) {
        chrome.runtime.sendMessage({ type: 'bringChildrenToFront', reason: 'window-focused' });
    }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'closeAllChildren') {
        cleanupChildren().then(() => sendResponse({ ok: true }));
        return true;
    }
    return false;
});
