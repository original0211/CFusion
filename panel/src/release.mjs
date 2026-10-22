export const PANEL_VERSION = '2026.10.17.2';

export function coreRelease(config) {
  const coreVersion = typeof config.coreVersion === 'string' ? config.coreVersion : '';
  return {
    panelVersion: PANEL_VERSION,
    coreVersion,
    needsUpdate: coreVersion !== PANEL_VERSION,
    changes: [
      '新增 Free CPU 保护开关，按单连接双向流量和数据块预算提前断开。',
      '默认关闭；开启后可能中断下载和视频，需客户端重连。更新配套内核后生效。',
    ],
    changesEn: [
      'Added the Free CPU protection switch, which drops a connection early based on per-connection two-way traffic and chunk budgets.',
      'Off by default; when on, downloads and video may be interrupted and clients must reconnect. Takes effect after updating the matching core.',
    ],
    zipUrl: 'https://raw.githubusercontent.com/byJoey/cfnew/core-only/pages.zip',
    workerUrl: 'https://raw.githubusercontent.com/byJoey/cfnew/core-only/_worker.js',
  };
}
