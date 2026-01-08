chrome.action.onClicked.addListener(async () => {
    const data = await chrome.storage.local.get(['controllerTabId']);

    if (data.controllerTabId) {
        try {
            const tab = await chrome.tabs.get(data.controllerTabId);
            await chrome.windows.update(tab.windowId, { focused: true });
            await chrome.tabs.update(tab.id, { active: true });
            return;
        } catch (e) {
            // Controller tab doesn't exist anymore
        }
    }

    const tab = await chrome.tabs.create({
        url: 'controller.html',
        active: true
    });

    await chrome.storage.local.set({ controllerTabId: tab.id });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    const data = await chrome.storage.local.get(['controllerTabId', 'childIds']);

    if (tabId === data.controllerTabId) {
        if (data.childIds) {
            for (const id of data.childIds) {
                try {
                    await chrome.windows.remove(id);
                } catch (e) {
                    // Window might already be closed
                }
            }
        }
        await chrome.storage.local.remove(['controllerTabId', 'childIds']);
    }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
    const data = await chrome.storage.local.get(['childIds']);

    if (data.childIds && data.childIds.includes(windowId)) {
        const updatedChildIds = data.childIds.filter(id => id !== windowId);
        await chrome.storage.local.set({ childIds: updatedChildIds });
    }
});
