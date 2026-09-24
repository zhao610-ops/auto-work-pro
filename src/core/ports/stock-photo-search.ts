export interface StockPhotoSearchRequest {
  query: string;
  locale?: string;
  orientation?: "landscape" | "portrait" | "square";
  perPage?: number;
}

export interface StockPhoto {
  id: string;
  imageUrl: string;
  pageUrl: string;
  photographer: string;
  photographerUrl: string;
  width: number;
  height: number;
}

export interface StockPhotoSearch {
  search(request: StockPhotoSearchRequest): Promise<StockPhoto[]>;
}
