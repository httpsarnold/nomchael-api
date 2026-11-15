/**
 * Stage matching for BOQs.
 *
 * A BOQ defines the stages of every house it is applied to. These helpers only ever
 * resolve a stage label against the stages of ONE BOQ, so a house never ends up with a
 * stage that is not on its BOQ.
 *
 * The web app keeps the same rules in apps/web/src/lib/propertyStages.ts.
 */

type Pick = 'first' | 'last';
type Candidate = { description: string; pick: Pick };

const c = (description: string, pick: Pick = 'first'): Candidate => ({ description, pick });

/**
 * Older labels (stage templates, earlier BOQs) pointed at the BOQ stage they stand for.
 * Each label lists the BOQ descriptions it may map to; the first one the BOQ has wins.
 */
const ALIASES: Record<string, Candidate[]> = {
  'back filling and compacting concrete slab': [c('concrete slab')],
  'concrete roof deck 1': [c('concrete roof deck'), c('concrete deck')],
  'concrete roof deck 2': [c('concrete roof deck'), c('concrete deck')],
  'concrete roof deck': [c('concrete deck')],
  'deck concrete': [c('concrete deck')],
  'roof deck steel fixing 1': [c('roof deck steel fixing'), c('deck steel fixing')],
  'roof deck steel fixing 2': [c('roof deck steel fixing'), c('deck steel fixing')],
  'roof deck steel fixing': [c('deck steel fixing')],
  'parapet and wall coping': [c('parrapet and wall couping'), c('parapet wall')],
  'parrapet and wall couping': [c('parapet wall')],
  'site clearing': [c('land clearing'), c('site clearance')],
  'land clearing': [c('site clearance')],
  'setting out': [c('column excavation')],
  'trench excavation': [c('column excavation')],
  'back filling and compacting': [c('back filling')],
  'fixing of bases, columns and ground beams': [c('steel fixing of bases and stubs')],
  'shuttering of bases columns and beams': [c('shuttering of stubs')],
  foundation: [c('concrete bases')],
  slab: [c('concrete slab')],
  'concrete slab': [c('concrete slab')],
  walls: [c('average level'), c('window level')],
  // The older "Average level" start was the start of the roof deck section, which on the
  // labour stages BOQs begins at deck steel fixing.
  'average level': [c('average level', 'last'), c('deck steel fixing')],
  'window level': [c('window level', 'last')],
  'shattering of ring beam': [c('ring beam shuttering')],
  'shuttering of ring beam': [c('ring beam shuttering', 'last')],
  'steel fixing of ring beam': [c('ring beam steel fixing')],
  'ring beam concrete': [c('concrete ring beam')],
  'steel fixing': [c('ring beam steel fixing', 'last')],
  'wall plate ff': [c('wall plate', 'last')],
  'steel structure': [c('steel fixing of ring beam'), c('ring beam steel fixing')],
  'roof structure': [c('wall plate')],
  plumbing: [c('plumbing fix and supply'), c('plumbing')],
  'plumbing fix and supply': [c('plumbing')],
};

/** "Section · Stage" labels reduce to the stage; lower-cased. */
export function quoteDescription(stage: string) {
  const parts = stage.split(' · ');
  return (parts.length > 1 ? parts.slice(1).join(' · ') : stage).trim().toLowerCase();
}

/** Same as quoteDescription without a trailing "(section)" qualifier. */
function baseDescription(stage: string) {
  return quoteDescription(stage).replace(/\s*\([^)]*\)\s*$/, '');
}

/**
 * Resolve a stored stage label onto one of the BOQ's stage labels.
 * With `strict`, a label the BOQ does not have returns '' instead of the label itself.
 */
export function resolveQuoteStage(
  label: string | null | undefined,
  quoteLabels: string[],
  strict = false,
): string {
  const index = resolveQuoteStageIndex(label, quoteLabels);
  if (index >= 0) return quoteLabels[index];
  const raw = label?.trim() || '';
  return strict ? '' : raw;
}

/**
 * Index of the quotation stage a stored label stands for.
 * A repeated name uses the alias rule, so "Average level" is the later one.
 * Returns -1 when the label is not on this quotation.
 */
export function resolveQuoteStageIndex(
  label: string | null | undefined,
  quoteLabels: string[],
): number {
  const raw = label?.trim() || '';
  if (!raw || !quoteLabels.length) return -1;
  const lower = raw.toLowerCase();
  const exact = quoteLabels
    .map((stage, index) => ({ stage, index }))
    .filter((item) => item.stage.toLowerCase() === lower);
  if (exact.length === 1) return exact[0].index;
  const bare = quoteDescription(raw);
  const keys = bare !== lower ? [lower, bare] : [lower];
  const pick = (description: string, which: Pick) => {
    const matches = quoteLabels
      .map((stage, index) => ({ stage, index }))
      .filter((item) => baseDescription(item.stage) === description);
    if (!matches.length) return -1;
    return which === 'first' ? matches[0].index : matches[matches.length - 1].index;
  };
  for (const key of keys) {
    for (const alias of ALIASES[key] || []) {
      const aliased = pick(alias.description, alias.pick);
      if (aliased >= 0) return aliased;
    }
  }
  for (const key of keys) {
    const described = pick(key, 'last');
    if (described >= 0) return described;
  }
  for (const key of keys) {
    const stripped = key.replace(/ \d+$/, '');
    if (stripped === key) continue;
    const numbered = pick(stripped, 'first');
    if (numbered >= 0) return numbered;
  }
  return -1;
}

/** The stage labels a list of BOQ lines defines, in order, without repeats. */
export function boqStageLabels(
  lines: { stageName?: string | null; sortOrder?: number }[] | null | undefined,
) {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const line of [...(lines || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    const label = (line.stageName || '').trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

/**
 * Give repeated stage names a "(section)" qualifier so every stage on a BOQ is unique.
 * Picking "Window level" must mean one place in the sequence, not two.
 */
export function uniqueStageNames<T extends { sectionName?: string | null; stageName: string }>(
  lines: T[],
  sectionTag: (sectionName: string) => string = (name) => name.toLowerCase(),
): T[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = line.stageName.trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return lines.map((line) => {
    const name = line.stageName.trim();
    const section = line.sectionName?.trim();
    if ((counts.get(name.toLowerCase()) || 0) < 2 || !section) return { ...line, stageName: name };
    return { ...line, stageName: `${name} (${sectionTag(section)})` };
  });
}
