import type {
  TextCompletionRequest,
  TextCompletionResponse,
  TextCompletionChunk,
} from '../model/text-completion-types.js';

export interface TextCompletionPort {
  complete(request: TextCompletionRequest): Promise<TextCompletionResponse>;
  stream(request: TextCompletionRequest): AsyncIterable<TextCompletionChunk>;
}
