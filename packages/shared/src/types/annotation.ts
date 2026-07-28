export interface Annotation {
  id: string;
  highlightId: string;
  userId: string;
  noteText: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAnnotationRequest {
  noteText: string;
}
