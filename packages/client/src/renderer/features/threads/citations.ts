import { ToolReference, type ToolCallState } from '@ash/shared';

export function parseSourceCitation(href: string): string | undefined {
  if (!href.startsWith('ash-source:')) return undefined;
  try {
    const id = decodeURIComponent(href.slice(11));
    return ToolReference.shape.id.safeParse(id).success ? id : undefined;
  } catch { return undefined; }
}

type CitationCall = Pick<ToolCallState, 'citationIds' | 'referenceIds' | 'resultArtifactId'>;
export function citationResult(calls: readonly CitationCall[], id: string): string | undefined {
  const scoped = calls.filter(call => call.resultArtifactId && call.citationIds?.includes(id));
  if (scoped.length) return scoped.length === 1 ? scoped[0].resultArtifactId : undefined;
  const historical = calls.filter(call => call.resultArtifactId && call.referenceIds?.includes(id));
  return historical.length === 1 ? historical[0].resultArtifactId : undefined;
}
