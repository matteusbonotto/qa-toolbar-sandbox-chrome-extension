export const OPEN_ACCOUNT_MODAL_EVENT = "qts:open-account-modal";

export function openAccountModal(): void {
  window.dispatchEvent(new Event(OPEN_ACCOUNT_MODAL_EVENT));
}
