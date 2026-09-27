import { useEffect } from 'react';
import './global-search-keyboard.css';

// Shared keyboard support for linked suggestion lists throughout Workspace/MES.
export default function GlobalSearchKeyboard() {
  useEffect(() => {
    let activeInput = null;
    let activeOption = null;
    let serial = 0;
    const listFor = input => input instanceof HTMLInputElement && !input.hasAttribute('list')
      ? document.getElementById(input.getAttribute('aria-controls')) : null;
    const clear = () => {
      activeOption?.removeAttribute('data-search-keyboard-active');
      if (activeOption?.getAttribute('role') === 'option') activeOption.setAttribute('aria-selected', 'false');
      activeInput?.removeAttribute('aria-activedescendant');
      activeOption = null;
    };
    const keydown = event => {
      const input = event.target;
      const list = listFor(input);
      if (event.defaultPrevented || event.isComposing || !list || !['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
      if (activeInput !== input) { clear(); activeInput = input; }
      if (event.key === 'Escape') {
        clear(); list.hidden = true; input.setAttribute('aria-expanded', 'false'); event.preventDefault(); event.stopPropagation(); return;
      }
      if (event.key === 'Enter') {
        if (!list.hidden && activeOption?.isConnected && list.contains(activeOption)) {
          event.preventDefault(); const option = activeOption; clear(); option.click();
        }
        return;
      }
      list.hidden = false;
      const options = [...list.querySelectorAll('[role="option"],input[type="checkbox"]')].filter(option => !option.disabled && option.getAttribute('aria-disabled') !== 'true' && option.getClientRects().length);
      if (!options.length) return;
      event.preventDefault();
      const current = options.indexOf(activeOption);
      const index = current < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      clear(); activeOption = options[index];
      if (!activeOption.id) activeOption.id = `workspace-search-option-${++serial}`;
      activeOption.setAttribute('data-search-keyboard-active', 'true');
      if (activeOption.getAttribute('role') === 'option') activeOption.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', activeOption.id);
      input.setAttribute('aria-expanded', 'true');
      activeOption.scrollIntoView({ block: 'nearest' });
    };
    const reset = event => {
      clear();
      const list = listFor(event.target);
      if (list) list.hidden = false;
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('input', reset);
    document.addEventListener('focusout', clear);
    return () => { clear(); document.removeEventListener('keydown', keydown); document.removeEventListener('input', reset); document.removeEventListener('focusout', clear); };
  }, []);
  return null;
}
