export type Cell = {
  address: string;
  raw: string;
  value: string;
  formula?: string;
  result?: string;
  review: boolean;
  type: string;
  numberFormat?: string;
  numberFormatId?: number;
  isDateTime?: boolean;
};
export type Workbook = {
  fileName: string;
  sheets: { name: string; cells: Cell[]; merges: string[] }[];
};
export type Paragraph = {
  kind: 'paragraph';
  location: string;
  text: string;
  numbers: string[];
};
export type WordCell = {
  column: number;
  span: number;
  merge?: string;
  text: string;
  paragraphs: Paragraph[];
};
export type WordTable = { kind: 'table'; location: string; rows: WordCell[][] };
export type WordDocument = {
  fileName: string;
  blocks: (Paragraph | WordTable)[];
};
