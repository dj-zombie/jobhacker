export function mount(): HTMLElement {
  const root = document.getElementById('root');
  if (!root) throw new Error('The page has no #root element');
  return root;
}
