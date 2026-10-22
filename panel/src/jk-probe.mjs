// CFusion 家宽连通性过滤：订阅生成时在边缘侧对候选 OpenVPN 节点做 TCP
// connect 探测，只保留能连通的。链式模式下 OpenVPN 服务器正是由 CF 边缘
// 经前置节点拨出的，所以从边缘探测的可达性就是实际使用口径。
//
// 纪律：探测能力缺失（非 Worker 运行时没有 cloudflare:sockets）、探测过程
// 整体异常、或全部探不通（多半是探测通道本身坏了）时一律 fail-open，
// 返回原列表，绝不让家宽订阅因为探测而整体消失。

export async function 过滤可达家宽节点(节点列表, { connect, 超时毫秒 = 3000, 并发上限 = 10 } = {}) {
  const 列表 = Array.isArray(节点列表) ? 节点列表 : [];
  if (!列表.length || typeof connect !== 'function') return 列表;
  const 存活 = new Array(列表.length).fill(false);
  let 游标 = 0;
  const 探测单个 = async 节点 => {
    let 套接字 = null;
    try {
      套接字 = connect({ hostname: 节点.地址, port: 节点.端口 });
      if (!套接字 || !套接字.opened || typeof 套接字.opened.then !== 'function') return false;
      return await Promise.race([
        套接字.opened.then(() => true, () => false),
        new Promise(解 => setTimeout(() => 解(false), 超时毫秒)),
      ]);
    } catch {
      return false;
    } finally {
      try { if (套接字) 套接字.close(); } catch {}
    }
  };
  try {
    const 工人 = async () => {
      while (游标 < 列表.length) {
        const 下标 = 游标++;
        存活[下标] = await 探测单个(列表[下标]);
      }
    };
    const 人数 = Math.max(1, Math.min(并发上限, 列表.length));
    await Promise.all(Array.from({ length: 人数 }, () => 工人()));
  } catch {
    return 列表;
  }
  const 结果 = 列表.filter((_, 下标) => 存活[下标]);
  return 结果.length ? 结果 : 列表;
}

export async function 边缘过滤家宽节点(节点列表, 选项 = {}) {
  let connect;
  try {
    ({ connect } = await import('cloudflare:sockets'));
  } catch {
    return 节点列表;
  }
  return 过滤可达家宽节点(节点列表, { ...选项, connect });
}
