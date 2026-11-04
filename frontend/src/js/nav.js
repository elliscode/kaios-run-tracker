// Keypad navigation, panels, softkeys and dialogs. Adapted from
// kaios-gps-location-sharer/frontend-v3/src/index.js, but app-agnostic: the
// app registers what the softkeys/Backspace do via Nav.setKeyHandler, and
// gets a two-choice confirm dialog on top of the sharer's OK-only one.
const Nav = (function () {
  const leftElement = document.getElementById('left');
  const centerElement = document.getElementById('center');
  const rightElement = document.getElementById('right');
  const dialogs = [];
  const scrollIntervals = [];

  let globalInteractTimer = new Date(0);
  // { onLeft, onRight, onEnter } while a dialog is open, else null
  let dialogHandlers = null;
  // softkeys to restore once a dialog closes
  let panelSoftkeys = ['', 'SELECT', ''];
  // app callback for SoftLeft / SoftRight / Backspace outside dialogs;
  // returns true when it handled the key
  let keyHandler = function () { return false; };

  function getAllElements() {
    return Array.from(document.querySelectorAll('[active="true"] [nav-selectable="true"]'));
  }
  function selectFirstElement() {
    const allElements = getAllElements();
    if (allElements.length > 0) {
      allElements[0].focus();
    }
  }
  function showPanel(panel, softkeys) {
    const panels = Array.from(document.getElementsByClassName('panel'));
    panels.forEach(function (x) {
      x.setAttribute('active', 'false');
    });
    panel.setAttribute('active', 'true');
    window.scrollTo({ top: 0 });
    selectFirstElement();
    if (softkeys) {
      panelSoftkeys = softkeys;
      setSoftkeys(softkeys[0], softkeys[1], softkeys[2]);
    }
  }
  function setPanelSoftkeys(left, center, right) {
    panelSoftkeys = [left, center, right];
    if (!dialogHandlers) {
      setSoftkeys(left, center, right);
    }
  }
  function setSoftkeys(left, center, right) {
    leftElement.innerText = left ? left : '';
    centerElement.innerText = center ? center : '';
    rightElement.innerText = right ? right : '';
  }
  function navigate(event, allElements) {
    const direction = event.key == 'ArrowDown' ? 1 : -1;
    let currentIndex = allElements.findIndex(function (x) {
      return x == event.target;
    });
    if (currentIndex < 0) {
      currentIndex = direction > 0 ? -1 : 0;
    }
    const desiredIndex = (currentIndex + direction + allElements.length) % allElements.length;
    if (desiredIndex == 0) {
      window.scrollTo({ top: 0 });
    } else {
      const rect = allElements[desiredIndex].getBoundingClientRect();
      const diff = (rect.y + 80) - window.innerHeight;
      if (diff > 0) {
        window.scrollBy({ top: diff });
      }
    }
    allElements[desiredIndex].focus();
  }
  function handleScroll(event) {
    if (event.type == 'keydown' && scrollIntervals.length <= 0) {
      actuallyScroll(event);
      scrollIntervals.push(setInterval(actuallyScroll, 200, event));
    } else if (event.type == 'keyup') {
      while (scrollIntervals.length > 0) {
        clearInterval(scrollIntervals.pop());
      }
    }
  }
  function actuallyScroll(event) {
    const direction = event.key == 'ArrowDown' ? 1 : -1;
    window.scrollBy({ top: direction * 60, behavior: "smooth" });
  }
  function dialogKey(event) {
    if (event.type != 'keydown') {
      return;
    }
    const handlers = dialogHandlers;
    let callback = undefined;
    if (event.key == 'SoftLeft' || event.key == 'Backspace') {
      callback = handlers.onLeft;
    } else if (event.key == 'SoftRight') {
      callback = handlers.onRight;
    } else if (event.key == 'Enter') {
      callback = handlers.onEnter;
    } else {
      return;
    }
    event.preventDefault();
    if (callback === undefined) {
      return;
    }
    closeDialogs();
    if (callback) {
      callback();
    }
  }
  function controlsListener(event) {
    if (dialogHandlers) {
      dialogKey(event);
      return;
    }
    const allElements = getAllElements();
    if (allElements.length <= 0 && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      handleScroll(event);
    } else if (event.type == 'keydown') {
      if (allElements.length > 0 && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        navigate(event, allElements);
      } else if (['SoftLeft', 'SoftRight', 'Backspace'].includes(event.key)) {
        if (keyHandler(event.key)) {
          event.preventDefault();
        }
      } else if (event.key == 'Enter') {
        const currentDate = new Date();
        if (currentDate - globalInteractTimer < 250) {
          return;
        }
        globalInteractTimer = currentDate;
        event.preventDefault();
        if (event.target && event.target.getAttribute && event.target.getAttribute('nav-selectable') == 'true') {
          event.target.click();
        }
      }
    }
  }
  function softkey(key) {
    controlsListener({ type: 'keydown', key: key, preventDefault: function () {}, target: document.activeElement });
  }
  function closeDialogs() {
    while (dialogs.length > 0) {
      dialogs.pop().remove();
    }
    if (dialogHandlers) {
      dialogHandlers = null;
      setSoftkeys(panelSoftkeys[0], panelSoftkeys[1], panelSoftkeys[2]);
    }
  }
  function buildDialog(title, text) {
    closeDialogs();
    let modalBg = document.createElement('div');
    modalBg.classList.add('dialog-bg');
    dialogs.push(modalBg);
    let modal = document.createElement('div');
    modal.classList.add('dialog');
    let header = document.createElement('div');
    header.classList.add('title');
    header.innerText = title;
    modal.appendChild(header);
    let body = document.createElement('div');
    body.classList.add('body');
    body.innerText = text;
    modal.appendChild(body);
    modalBg.appendChild(modal);
    document.body.appendChild(modalBg);
  }
  // OK-only message; any softkey or Enter dismisses it.
  function showDialog(title, text, onClose) {
    buildDialog(title, text);
    const close = onClose || null;
    dialogHandlers = { onLeft: close, onRight: close, onEnter: close };
    setSoftkeys('', 'OKAY', '');
  }
  // Two choices on the softkeys. Enter deliberately does nothing, so a stray
  // double-press of the center key can never confirm something destructive.
  function showConfirm(title, text, leftLabel, onLeft, rightLabel, onRight) {
    buildDialog(title, text);
    dialogHandlers = { onLeft: onLeft || null, onRight: onRight || null, onEnter: undefined };
    setSoftkeys(leftLabel, '', rightLabel);
  }
  function setKeyHandler(handler) {
    keyHandler = handler;
  }

  document.addEventListener('keydown', controlsListener);
  document.addEventListener('keyup', controlsListener);

  return {
    showPanel: showPanel,
    setPanelSoftkeys: setPanelSoftkeys,
    selectFirstElement: selectFirstElement,
    showDialog: showDialog,
    showConfirm: showConfirm,
    closeDialogs: closeDialogs,
    setKeyHandler: setKeyHandler,
    softkey: softkey,
  };
})();
