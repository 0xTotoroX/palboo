/* [INPUT]: Visible row weights, available CSS height and measured header height.
 * [OUTPUT]: Complete title rows, readable expanded rows and cascading separator transfers.
 * [POS]: Pure sidebar geometry, also used by the settings demonstration.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
export function compactRows(weights, height, header = 36, gap = 8) {
  if (!weights.length) return [];
  const minimum = header + 84;
  const available = Math.max(
    height - gap * (weights.length - 1),
    header * (weights.length - 1) + minimum,
  );
  const closed = new Set();
  let sizes;
  for (;;) {
    const open = weights.map((_, i) => i).filter((i) => !closed.has(i));
    const total = open.reduce((sum, i) => sum + weights[i], 0);
    sizes = weights.map((weight, i) =>
      closed.has(i) ? header : ((available - closed.size * header) * weight) / total,
    );
    const smallest = open.reduce((a, b) => (sizes[a] <= sizes[b] ? a : b));
    if (open.length === 1 || sizes[smallest] >= minimum) break;
    closed.add(smallest);
  }
  return sizes.map((height, i) => ({ height, collapsed: closed.has(i) }));
}

export function transferRows(heights, boundary, delta, header = 36) {
  const result = [...heights];
  const receiver = delta >= 0 ? boundary - 1 : boundary;
  const donors = heights
    .map((_, i) => i)
    .filter((i) => (delta >= 0 ? i >= boundary : i < boundary));
  if (delta < 0) donors.reverse();
  let remaining = Math.abs(delta);
  for (const i of donors) {
    const amount = Math.min(remaining, Math.max(0, result[i] - header));
    result[i] -= amount;
    result[receiver] += amount;
    remaining -= amount;
  }
  return result;
}
