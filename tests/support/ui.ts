import type { Page, Route } from 'playwright';

// Keep routes installed while the application polls. Remove them only after its document stops.
export class PollingRoutes {
  private installed = false;
  constructor(private page: Page) {}
  async add(match: string | RegExp, handler: (route: Route) => Promise<void>) {
    await this.page.route(match, handler);
    this.installed = true;
  }
  async dispose() {
    if (!this.installed || this.page.isClosed()) return;
    await this.page.goto('about:blank');
    await this.page.unrouteAll({ behavior: 'wait' });
    this.installed = false;
  }
}

export async function clearDraftBeforeReload(page: Page, threadId: string) {
  await page.addInitScript(id => {
    const drafts = JSON.parse(localStorage.getItem('ash-chat-drafts') ?? '{}');
    delete drafts[id]; localStorage.setItem('ash-chat-drafts', JSON.stringify(drafts));
  }, threadId);
}

export async function closeInspector(page: Page) {
  const panel = page.getByRole('complementary', { name: 'Artifact inspector', exact: true });
  await panel.waitFor();
  await panel.evaluate(async element => {
    if (element.dataset.forming === 'true') await new Promise<void>(resolve => {
      const observer = new MutationObserver(() => {
        if (element.dataset.forming !== 'true') { observer.disconnect(); resolve(); }
      });
      observer.observe(element, { attributes: true, attributeFilter: ['data-forming'] });
    });
    await Promise.allSettled((element.closest('.ash-rail') ?? element).getAnimations({ subtree: true })
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations))
      .map(animation => animation.finished));
  });
  await panel.getByRole('button', { name: 'Close inspector', exact: true }).click();
  await page.locator('.inspector-rail').waitFor({ state: 'detached' });
}
