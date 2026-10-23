/* No content scripts: controls never share the message document. */
async function openAnalysis(tab) {
  const url = new URL(messenger.runtime.getURL('analysis.html'));
  if (Number.isInteger(tab?.id)) url.searchParams.set('sourceTab', tab.id);
  await messenger.tabs.create({url:url.href});
}
messenger.messageDisplayAction.onClicked.addListener(openAnalysis);
messenger.browserAction.onClicked.addListener(openAnalysis);
