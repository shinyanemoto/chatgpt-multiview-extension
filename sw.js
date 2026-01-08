chrome.action.onClicked.addListener(async () => {
    const data = await chrome.storage.local.get(['controllerId']);

    if (data.controllerId) {
        try {
            await chrome.windows.get(data.controllerId);
            await chrome.windows.update(data.controllerId, { focused: true });
            return;
        } catch (e) {
            // Controller window doesn't exist anymore
        }
    }

    // Create new controller window
    const window = await chrome.windows.create({
        url: 'controller.html',
        type: 'popup',
        width: 1200,
        height: 900
    });

    await chrome.storage.local.set({ controllerId: window.id });
});

chrome.windows.onRemoved.addListener(async (windowId) => {
    const data = await chrome.storage.local.get(['controllerId', 'childIds']);

    if (windowId === data.controllerId) {
        // Parent closed, close all children
        if (data.childIds) {
            for (const id of data.childIds) {
                try {
                    await chrome.windows.remove(id);
                } catch (e) {
                    // Window might already be closed
                }
            }
        }
        await chrome.storage.local.remove(['controllerId', 'childIds']);
    } else if (data.childIds && data.childIds.includes(windowId)) {
        // One of the children closed, we could potentially recreate it or just remove from list
        const updatedChildIds = data.childIds.filter(id => id !== windowId);
        await chrome.storage.local.set({ childIds: updatedChildIds });
    }
});
