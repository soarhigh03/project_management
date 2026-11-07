// Keep the select's value/change contract while rendering a consistent dropdown.
export function createFilterChip(select, { field = false } = {}) {
  const controller = new AbortController();
  const { signal } = controller;
  const root = document.createElement('div');
  root.className = field ? 'filter-chip field-select' : 'filter-chip';
  const trigger = document.createElement('button');
  trigger.id = `${select.id}-trigger`;
  trigger.type = 'button';
  trigger.className = 'filter-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${select.id}-options`);
  const label = document.createElement('span');
  const arrow = document.createElement('span');
  arrow.className = 'filter-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  trigger.append(label, arrow);

  // Every option contributes to intrinsic width, even when the menu is closed.
  const size = document.createElement('span');
  size.className = 'filter-size';
  size.setAttribute('aria-hidden', 'true');
  const menu = document.createElement('div');
  menu.id = `${select.id}-options`;
  menu.className = 'filter-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', select.getAttribute('aria-label'));
  // A top-layer menu stays below its field without being clipped by the dialog.
  const usePopover = field && typeof menu.showPopover === 'function';
  if (usePopover) menu.setAttribute('popover', 'manual');
  const options = [...select.options].map(option => {
    const measure = document.createElement('span');
    measure.textContent = option.textContent;
    size.append(measure);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-option';
    button.tabIndex = -1;
    button.setAttribute('role', 'option');
    button.textContent = option.textContent;
    button.dataset.value = option.value;
    button.onclick = () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      close(true);
    };
    menu.append(button);
    return button;
  });
  select.before(root);
  select.hidden = true;
  select.tabIndex = -1;
  root.append(select, size, trigger, menu);

  function sync() {
    label.textContent = select.selectedOptions[0]?.textContent || '';
    trigger.disabled = select.disabled;
    for (const option of options) option.setAttribute('aria-selected', String(option.dataset.value === select.value));
  }
  function close(focus = false) {
    if (usePopover && menu.matches(':popover-open')) menu.hidePopover();
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus({ preventScroll: true });
  }
  function open(index = select.selectedIndex) {
    const rect = trigger.getBoundingClientRect();
    const viewportBottom = window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight;
    menu.style.maxHeight = `${Math.max(44, Math.min(280, viewportBottom - rect.bottom - 12))}px`;
    if (usePopover) {
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 6}px`;
      menu.style.width = `${rect.width}px`;
    }
    menu.hidden = false;
    if (usePopover) menu.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    options[Math.max(0, index)]?.focus({ preventScroll: true });
  }
  trigger.onclick = () => menu.hidden ? open() : close(true);
  trigger.onkeydown = event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      open(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : select.selectedIndex);
    }
  };
  let search = '', searchTimer;
  menu.onkeydown = event => {
    const index = options.indexOf(document.activeElement);
    const next = { ArrowDown: (index + 1) % options.length, ArrowUp: (index - 1 + options.length) % options.length, Home: 0, End: options.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); options[next].focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close(true);
    else if (event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey) {
      clearTimeout(searchTimer);
      search += event.key.toLowerCase();
      options.find(option => option.textContent.toLowerCase().startsWith(search))?.focus();
      searchTimer = setTimeout(() => { search = ''; }, 500);
    }
  };
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) close(); }, { signal });
  document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) close(); }, { signal });
  window.addEventListener('resize', () => close(), { signal });
  select.closest('dialog')?.addEventListener('scroll', () => close(), { signal });
  window.visualViewport?.addEventListener('resize', () => close(), { signal });
  select.addEventListener('change', sync, { signal });
  sync();
  return {
    sync, close,
    focus: () => trigger.focus(),
    destroy() { close(); clearTimeout(searchTimer); controller.abort(); }
  };
}
