let currentLayout = '2x2';
let childIds = [];
let lastBounds = { left: 0, top: 0, width: 0, height: 0 };
let isUpdating = false;
let isReconciling = false;
let lastUpdates = [];
let lastBringToFrontAt = 0;
let reshowTimeoutId = null;
let isMoving = false;
const TOOLBAR_HEIGHT = 50; // Should match CSS
const GAP = 8;
const POLL_INTERVAL = 200;
const MIN_PARENT_SIZE = 120;
const BRING_TO_FRONT_THROTTLE_MS = 300;
const RESHOW_DEBOUNCE_MS = 800;

async function init() {
    const data = await chrome.storage.local.get(['layout', 'childIds']);
    if (data.layout) {
        currentLayout = data.layout;
        updateLayoutButtons();
    }

    await reshowChildren('initial');
    startPolling();

    document.getElementById('btn-refresh').addEventListener('click', refreshAll);
    document.getElementById('btn-retile').addEventListener('click', () => tileWindows({ force: true }));
    document.getElementById('btn-reshow').addEventListener('click', () => reshowChildren('manual-reshow'));
    document.getElementById('btn-reopen').addEventListener('click', () => reopenChildren());
    document.getElementById('layout-2x2').addEventListener('click', () => setLayout('2x2'));
    document.getElementById('layout-1-3').addEventListener('click', () => setLayout('1+3'));
    document.getElementById('btn-close').addEventListener('click', async () => {
        try {
            await chrome.runtime.sendMessage({ type: 'closeAllChildren' });
        } catch (e) { }
        window.close();
    });

    const versionLabel = document.getElementById('version-label');
    if (versionLabel) {
        const version = chrome.runtime.getManifest().version;
        versionLabel.textContent = `Version: ${version}`;
    }
}

async function createChildWindow() {
    const win = await chrome.windows.create({
        url: 'https://chatgpt.com/',
        type: 'popup',
        width: 400,
        height: 400
    });
    return win.id;
}

async function validateChildIds() {
    const data = await chrome.storage.local.get(['childIds']);
    const existingIds = data.childIds || [];
    const validatedIds = [];

    // Check which children still exist
    for (const id of existingIds) {
        try {
            await chrome.windows.get(id);
            validatedIds.push(id);
        } catch (e) {
            // Doesn't exist
        }
    }

    childIds = validatedIds;
    await chrome.storage.local.set({ childIds });
    return validatedIds;
}

async function reconcileChildren() {
    if (isReconciling) return;
    isReconciling = true;

    const validatedIds = await validateChildIds();

    // Create missing children
    while (validatedIds.length < 4) {
        try {
            const id = await createChildWindow();
            validatedIds.push(id);
        } catch (e) {
            break;
        }
    }

    childIds = validatedIds;
    await chrome.storage.local.set({ childIds });
    isReconciling = false;
}

function setLayout(layout) {
    currentLayout = layout;
    chrome.storage.local.set({ layout });
    updateLayoutButtons();
    tileWindows({ force: true });
}

function updateLayoutButtons() {
    document.getElementById('layout-2x2').classList.toggle('active', currentLayout === '2x2');
    document.getElementById('layout-1-3').classList.toggle('active', currentLayout === '1+3');
}

async function refreshAll() {
    for (const id of childIds) {
        try {
            const tabs = await chrome.tabs.query({ windowId: id });
            if (tabs.length > 0) {
                chrome.tabs.reload(tabs[0].id);
            }
        } catch (e) { }
    }
}

async function tileWindows(options = {}) {
    const normalizedOptions = typeof options === 'boolean' ? { force: options } : options;
    const {
        force = false,
        scheduleReshow = true,
        bringToFront = false
    } = normalizedOptions;

    if (isUpdating) return;
    isUpdating = true;

    try {
        await reconcileChildren();
        if (childIds.length < 4) {
            return;
        }

        const parentBounds = getParentBounds();
        if (!parentBounds) {
            return;
        }

        const boundsChanged = parentBounds.left !== lastBounds.left ||
            parentBounds.top !== lastBounds.top ||
            parentBounds.width !== lastBounds.width ||
            parentBounds.height !== lastBounds.height;

        // Check if moved or resized
        if (!force && !boundsChanged) {
            return;
        }

        lastBounds = {
            left: parentBounds.left,
            top: parentBounds.top,
            width: parentBounds.width,
            height: parentBounds.height
        };

        if (boundsChanged && scheduleReshow) {
            isMoving = true;
            scheduleReshowAfterStop();
        }

        const usableWidth = parentBounds.width - (GAP * 3);
        const usableHeight = parentBounds.height - TOOLBAR_HEIGHT - (GAP * 3);
        const startX = parentBounds.left + GAP;
        const startY = parentBounds.top + TOOLBAR_HEIGHT + GAP;

        let updates = [];

        if (currentLayout === '2x2') {
            const w = Math.floor(usableWidth / 2);
            const h = Math.floor(usableHeight / 2);

            updates = [
                { left: startX, top: startY, width: w, height: h },
                { left: startX + w + GAP, top: startY, width: w, height: h },
                { left: startX, top: startY + h + GAP, width: w, height: h },
                { left: startX + w + GAP, top: startY + h + GAP, width: w, height: h }
            ];
        } else if (currentLayout === '1+3') {
            const mainW = Math.floor(usableWidth * 0.65);
            const sideW = usableWidth - mainW;
            const sideH = Math.floor((usableHeight - (GAP * 2)) / 3);

            updates = [
                { left: startX, top: startY, width: mainW, height: usableHeight + GAP * 2 },
                { left: startX + mainW + GAP, top: startY, width: sideW, height: sideH },
                { left: startX + mainW + GAP, top: startY + sideH + GAP, width: sideW, height: sideH },
                { left: startX + mainW + GAP, top: startY + (sideH + GAP) * 2, width: sideW, height: sideH }
            ];
        }

        for (let i = 0; i < 4; i++) {
            if (childIds[i]) {
                try {
                    await chrome.windows.update(childIds[i], updates[i]);
                    lastUpdates[i] = updates[i];
                } catch (e) {
                    // If update fails, child might be closed
                    console.error("Failed to update child window", e);
                }
            }
        }

        if (bringToFront && childIds.length > 0) {
            await bringChildrenToFront(normalizedOptions.reason || 'reshow');
        }
    } catch (e) {
        console.error("Error in tileWindows", e);
    } finally {
        isUpdating = false;
    }
}

function scheduleReshowAfterStop() {
    if (reshowTimeoutId) {
        clearTimeout(reshowTimeoutId);
    }
    reshowTimeoutId = setTimeout(() => {
        reshowTimeoutId = null;
        if (isMoving) {
            reshowChildren('auto-reshow');
        }
    }, RESHOW_DEBOUNCE_MS);
}

async function reshowChildren(reason) {
    const validatedIds = await validateChildIds();
    console.log('reshowChildren triggered', { reason, validatedChildIds: [...validatedIds] });

    if (validatedIds.length < 4) {
        await reconcileChildren();
    }

    console.log('reshowChildren tile start', { childIds: [...childIds] });
    await tileWindows({ force: true, scheduleReshow: false, bringToFront: false });

    await focusLastChild(reason);

    await new Promise(resolve => setTimeout(resolve, 300));
    const allWindows = await chrome.windows.getAll({ populate: false });
    const existingIds = new Set(allWindows.map(win => win.id));
    const availableChildIds = childIds.filter(id => existingIds.has(id));
    const focusedChild = await getFocusedChildId();
    const shouldReplace = availableChildIds.length !== 4 || !focusedChild;

    console.log('reshowChildren replace check', {
        shouldReplace,
        availableChildIds: [...availableChildIds],
        focusedChild
    });

    if (shouldReplace) {
        const keepId = focusedChild || availableChildIds[availableChildIds.length - 1];
        const idsToClose = availableChildIds.filter(id => id !== keepId);
        for (const id of idsToClose) {
            try {
                await chrome.windows.remove(id);
            } catch (e) {
                // Ignore missing windows
            }
        }
        const rebuiltIds = keepId ? [keepId] : [];
        while (rebuiltIds.length < 4) {
            try {
                const id = await createChildWindow();
                rebuiltIds.push(id);
            } catch (e) {
                break;
            }
        }
        childIds = rebuiltIds;
        await chrome.storage.local.set({ childIds });
        await tileWindows({ force: true, scheduleReshow: false, bringToFront: false });
        await focusLastChild('reshow-replace');
    }

    console.log('reshowChildren done', { childIds: [...childIds] });
    isMoving = false;
}

async function reopenChildren() {
    const data = await chrome.storage.local.get(['childIds']);
    const oldChildIds = data.childIds || [];
    console.log('reopenChildren start', { oldChildIds: [...oldChildIds] });

    for (const id of oldChildIds) {
        try {
            await chrome.windows.remove(id);
        } catch (e) {
            // Ignore missing windows
        }
    }

    childIds = [];
    await chrome.storage.local.set({ childIds });

    const newChildIds = [];
    while (newChildIds.length < 4) {
        try {
            const id = await createChildWindow();
            newChildIds.push(id);
        } catch (e) {
            break;
        }
    }

    childIds = newChildIds;
    await chrome.storage.local.set({ childIds });
    await tileWindows({ force: true, scheduleReshow: false, bringToFront: false });
    await focusLastChild('reopen');
    console.log('reopenChildren done', { newChildIds: [...newChildIds] });
}

async function focusLastChild(reason) {
    const now = Date.now();
    if (now - lastBringToFrontAt < BRING_TO_FRONT_THROTTLE_MS) {
        return;
    }
    lastBringToFrontAt = now;

    if (!childIds.length) {
        return;
    }

    console.log('bringChildrenToFront triggered', { reason, childIds: [...childIds] });

    const lastIndex = childIds.length - 1;
    for (let i = 0; i < childIds.length; i++) {
        const id = childIds[i];
        const updateInfo = lastUpdates[i];
        try {
            if (updateInfo) {
                await chrome.windows.update(id, updateInfo);
            }
            if (i === lastIndex) {
                await chrome.windows.update(id, { focused: true });
            } else {
                await chrome.windows.update(id, { focused: false });
            }
        } catch (e) {
            console.error("Failed to bring child window to front", e);
        }
    }
}

async function getFocusedChildId() {
    try {
        const focused = await chrome.windows.getLastFocused();
        if (focused && childIds.includes(focused.id)) {
            return focused.id;
        }
    } catch (e) { }
    return null;
}

function getParentBounds() {
    const left = window.screenX + getHorizontalWindowInset();
    const top = window.screenY + getVerticalWindowInset();
    const width = window.innerWidth;
    const height = window.innerHeight;

    if (!Number.isFinite(left) ||
        !Number.isFinite(top) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= MIN_PARENT_SIZE ||
        height <= MIN_PARENT_SIZE) {
        return null;
    }

    console.log('tileWindows called', { parentBounds: { left, top, width, height } });

    return { left, top, width, height };
}

function getHorizontalWindowInset() {
    const inset = window.outerWidth - window.innerWidth;
    return Math.max(0, Math.round(inset / 2));
}

function getVerticalWindowInset() {
    const inset = window.outerHeight - window.innerHeight;
    return Math.max(0, Math.round(inset));
}

function startPolling() {
    setInterval(tileWindows, POLL_INTERVAL);
}

document.addEventListener('DOMContentLoaded', init);
