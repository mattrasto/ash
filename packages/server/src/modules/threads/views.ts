import type { Artifact, Run } from '@prisma/client';
import { InputPayload, MessagePayload, RequestPayload, DescriptionPayload, ToolArtifact, VideoArtifact, EngineArtifact, RunState, RunError, RunStatus, type ArtifactView, type RunView } from '@ash/shared';

export function artifactView(row:Artifact):ArtifactView {
  const payload = row.layer === 'input' ? InputPayload.parse(row.payload) : row.layer === 'surface' ? MessagePayload.parse(row.payload)
    : ['engine_request','engine_response','filter_result','route_result','act_plan','engine_error'].includes((row.payload as {type:string}).type) ? EngineArtifact.parse(row.payload)
    : (row.payload as {type?:string}).type === 'image_description' ? DescriptionPayload.parse(row.payload)
    : (row.payload as {type?:string}).type === 'model_request' ? RequestPayload.parse(row.payload)
    : (row.payload as {type?:string}).type?.startsWith('video_') ? VideoArtifact.parse(row.payload) : ToolArtifact.parse(row.payload);
  return {...row,payload,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
export function runView(row:Run):RunView {
  return {id:row.id,requestKey:row.requestKey,inputArtifactId:row.inputArtifactId,threadId:row.threadId,retryOfId:row.retryOfId,
    status:RunStatus.parse(row.status),state:RunState.parse(row.state),error:row.error===null?null:RunError.parse(row.error),
    createdAt:row.createdAt.toISOString(),startedAt:row.startedAt?.toISOString()??null,endedAt:row.endedAt?.toISOString()??null};
}
