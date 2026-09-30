import {useEffect} from 'react';

// Apply only inside the authenticated Workspace shell, including its modal portals.
export default function useWorkspaceAutofillPolicy() {
  useEffect(() => {
    const apply = root => {
      if (!(root instanceof Element)) return;
      const fields = [...(root.matches('form,input,textarea') ? [root] : []), ...root.querySelectorAll('form,input,textarea')];
      for (const field of fields) {
        if (field.matches('input[type=checkbox],input[type=radio],input[type=file],input[type=hidden],input[type=button],input[type=submit]')) continue;
        field.setAttribute('autocomplete', field.matches('input[type=password]') ? 'new-password' : 'off');
        if (field.tagName !== 'FORM') {
          field.setAttribute('data-lpignore', 'true');
          field.setAttribute('data-1p-ignore', 'true');
        }
      }
    };
    apply(document.body);
    const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(apply)));
    observer.observe(document.body, {childList:true,subtree:true});
    return () => observer.disconnect();
  }, []);
}
