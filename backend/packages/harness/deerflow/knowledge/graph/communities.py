"""Louvain 社区检测纯函数（graph visualization spec §4 P1）。

把实体/关系表投影为无向图跑 Louvain，返回「实体名 → 社区 id」映射。
着色稳定性的全部保证集中在两处：
- 固定随机种子（seed=42）：同数据两次调用划分一致，前端色板不抖；
- 社区 id 按规模降序重编号：0 = 最大社区，主色恒给最大主题簇。

百节点规模 Louvain <10ms，调用方无需 to_thread；万级时再评估。
"""

from __future__ import annotations

from collections.abc import Iterable

import networkx as nx

#: 固定随机种子——Louvain 内部有随机性，钉死保证同数据同划分。
_LOUVAIN_SEED = 42


def assign_communities(node_names: Iterable[str], edges: Iterable[tuple[str, str]]) -> dict[str, int]:
    """返回每个节点的社区 id（按社区规模降序编号，0 = 最大社区）。

    防御规则：
    - 自环边剔除（抽取噪声，Louvain 不允许自环参与模块度计算）；
    - 端点不在节点集合中的边跳过（脏数据不引入幻影节点）；
    - 孤立节点（无边）由 Louvain 自然各成单点社区。
    """
    names = list(dict.fromkeys(node_names))  # 去重保序
    if not names:
        return {}

    graph = nx.Graph()
    graph.add_nodes_from(names)
    known = set(names)
    graph.add_edges_from((source, target) for source, target in edges if source != target and source in known and target in known)

    communities = nx.community.louvain_communities(graph, seed=_LOUVAIN_SEED)
    # 规模降序（成员数相同按最小名字典序，保证完全确定性）→ 重编号。
    ordered = sorted(communities, key=lambda members: (-len(members), min(members)))
    return {name: cid for cid, members in enumerate(ordered) for name in members}
