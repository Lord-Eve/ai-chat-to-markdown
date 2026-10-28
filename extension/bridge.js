  // Inserted inside the shared core by build-extension.js; extension APIs stay out of the userscript.
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'ai2md') return;
    if (AD.available && !AD.available()) {
      respond({ error: '请先打开具体会话或分享页。' });
      return;
    }
    mountButtons();
    if (message.action === 'status') {
      respond({ platform: AD.name, exporting });
    } else if (message.action === 'export') {
      if (exporting) { respond({ error: '正在导出，请等待当前任务完成。' }); return; }
      const withImages = message.images !== false;
      const button = document.getElementById(withImages ? 'ai2md-export' : 'ai2md-export-text');
      setPanelOpen(true);
      void doExport(button, withImages);
      respond({ started: true });
    } else if (message.action === 'diagnostics') {
      doDebugDump();
      respond({ started: true });
    }
  });
