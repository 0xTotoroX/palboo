/* [INPUT]: Visible pane weights, available space and measured compact size.
 * [OUTPUT]: Compact panes, readable expanded panes and separator transfers.
 * [POS]: Pure vertical-row geometry, also used by the settings demonstration.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
export function compactRows(
  weights,
  height,
  header = 36,
  gap = 8,
  collapsed = [],
  branchMinimums = [],
  columnMinimum = 0,
) {
  if (!weights.length) return [];
  const indices = weights.map((_, i) => i);
  const closed = new Set(indices.filter((i) => !branchMinimums[i] && collapsed[i]));
  if (closed.size === weights.length)
    return weights.map(() => ({ height: header, collapsed: true }));
  const minimum = header + 84;
  const fixed = new Map([...closed].map((i) => [i, header]));
  const floors = indices.map(
    (i) => branchMinimums[i] || (!closed.has(i) && columnMinimum) || header,
  );
  const firstBranch = branchMinimums.findIndex(Boolean);
  const hasBranches = firstBranch !== -1;
  const available = Math.max(
    height - gap * (weights.length - 1),
    floors.reduce((sum, floor) => sum + floor, 0) +
      (hasBranches || columnMinimum ? 0 : minimum - header),
  );
  let sizes;
  for (;;) {
    const open = indices.filter((i) => !fixed.has(i));
    const total = open.reduce((sum, i) => sum + weights[i], 0);
    const remaining = available - [...fixed.values()].reduce((sum, size) => sum + size, 0);
    if (!open.length) {
      sizes = indices.map(
        (i) => fixed.get(i) + (i === (firstBranch < 0 ? 0 : firstBranch) ? remaining : 0),
      );
      break;
    }
    sizes = weights.map((weight, i) => fixed.get(i) ?? (remaining * weight) / total);
    const branch = open.find((i) => (branchMinimums[i] || columnMinimum) && sizes[i] < floors[i]);
    if (branch !== undefined) {
      fixed.set(branch, floors[branch]);
      continue;
    }
    const leaves = open.filter((i) => !branchMinimums[i] && sizes[i] < minimum);
    if (columnMinimum || !leaves.length || (!hasBranches && open.length === 1)) break;
    const smallest = leaves.reduce((a, b) => (sizes[a] <= sizes[b] ? a : b));
    closed.add(smallest);
    fixed.set(smallest, header);
  }
  return sizes.map((height, i) => ({ height, collapsed: closed.has(i) }));
}

export function transferRows(
  heights,
  boundary,
  delta,
  header = 36,
  branchMinimums = [],
  cascade = true,
) {
  const result = [...heights];
  const receiver = delta >= 0 ? boundary - 1 : boundary;
  const donors = heights
    .map((_, i) => i)
    .filter((i) => (delta >= 0 ? i >= boundary : i < boundary));
  if (delta < 0) donors.reverse();
  let remaining = Math.abs(delta);
  for (const i of donors) {
    const amount = Math.min(remaining, Math.max(0, result[i] - (branchMinimums[i] || header)));
    result[i] -= amount;
    result[receiver] += amount;
    remaining -= amount;
    if (!cascade) break;
  }
  return result;
}
