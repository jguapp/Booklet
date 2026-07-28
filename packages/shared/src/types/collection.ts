export interface Collection {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on list endpoints -- omitted where it'd cost an extra query for no reason. */
  articleCount?: number;
}

export interface CreateCollectionRequest {
  name: string;
  color?: string | null;
}

export interface UpdateCollectionRequest {
  name?: string;
  color?: string | null;
}
