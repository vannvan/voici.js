import _merge from 'lodash/merge';

import { Row } from './table';
import { Accumulation } from './accumulation';

/**
 * Type of the origin column.
 * The origin value is the index of the row in the original dataset.
 */
export type TOriginColumn = '#';

/**
 * Infers the attributes of a row.
 * For arrays type `number` is used for indexing.
 * Otherwise a included key of the row, like an interface's attribute.
 */
export type InferRowAttributes<TRow extends Row> = TRow extends unknown[] ? number : keyof TRow;
export type InferRowAttributesOrigin<TRow extends Row> = InferRowAttributes<TRow> | TOriginColumn;

/**
 * Infers the attributes of a dynamic column or `never` if none provided.
 */
export type InferDynamicAttributes<TDColumns extends object> = [TDColumns] extends [never]
  ? never
  : keyof TDColumns;

/**
 * Infers the attributes of a row including the dynamic and origin columns.
 */
export type InferAttributes<TRow extends Row, TDColumns extends object = never> =
  | InferRowAttributes<TRow>
  | InferDynamicAttributes<TDColumns>;
export type InferAttributesOrigin<TRow extends Row, TDColumns extends object = never> =
  | InferAttributes<TRow, TDColumns>
  | TOriginColumn;

/**
 * A dataset row is a row that combines the values of a `dataset` and a `dynamicColumns` row.
 */
export type DatasetRow<TRow extends Row, TDColumns extends object> = [TDColumns] extends [never]
  ? { [Key in keyof TRow as InferRowAttributesOrigin<TRow>]: TRow[Key] } // No dynamic columns provided
  : {
      [Key in keyof (TRow & TDColumns) as InferAttributesOrigin<TRow, TDColumns>]: (TRow &
        TDColumns)[Key];
    }; // Dynamic columns provided

/**
 * Infers the keys of a {@link DatasetRow}.
 */
export type InferDatasetRowAttributes<
  TRow extends Row,
  TDColumns extends object
> = keyof DatasetRow<TRow, TDColumns>;

/**
 * Infers the keys of a {@link DatasetRow} including the {@link TOriginColumn}.
 */
export type InferDatasetRowAttributesOrigin<TRow extends Row, TDColumns extends object> =
  | InferDatasetRowAttributes<TRow, TDColumns>
  | TOriginColumn;

// <===== Config specific =====>

export type Sort<TAttributes> = {
  columns: TAttributes[];
  directions: Array<'asc' | 'desc'>;
};

export type DynamicColumn<TRow extends Row, TDColumns extends object> = {
  [Key in keyof TDColumns]: (row: TRow, index: number) => TDColumns[keyof TDColumns];
};

export type AccumulationRow<TRow extends object, TDColumns extends object> = {
  [K in InferDatasetRowAttributesOrigin<TRow, TDColumns>]: unknown;
};

export type Config<TRow extends Row, TDColumns extends object = never> = Partial<{
  align: 'LEFT' | 'CENTER' | 'RIGHT';
  bgColorColumns: string[];
  body: Partial<{
    subset: [number?, number?];
    accumulation: Partial<{
      bgColor: string;
      columns: Partial<Accumulation<TRow, TDColumns>>;
      separator: string;
    }>;
    bgColor: string;
    filterRow: (row: DatasetRow<TRow, TDColumns>, index: number) => boolean;
    highlightCell: Partial<{
      func: (content: unknown, row: number, col: InferAttributes<TRow, TDColumns>) => boolean;
      textColor: string;
    }>;
    highlightRow: Partial<{
      bgColor: string;
      func: (row: DatasetRow<TRow, TDColumns>, index: number) => boolean;
    }>;
    precision: number;
    striped: boolean;
    textColor: string;
    peek: number | [number, number];
  }>;
  border: Partial<{
    color: string;
    groupSize: number;
    horizontal: string;
    vertical: string;
  }>;
  header: Partial<{
    bgColor: string;
    bold: boolean;
    include: InferRowAttributes<TRow>[];
    exclude: InferRowAttributes<TRow>[];
    dynamic: DynamicColumn<TRow, TDColumns>;
    italic: boolean;
    displayNames: Partial<{
      [key in InferAttributesOrigin<TRow, TDColumns>]: string;
    }>;
    origin: boolean;
    order: InferAttributesOrigin<TRow, TDColumns>[];
    separator: string;
    textColor: string;
    underline: boolean;
    uppercase: boolean;
    lowercase: boolean;
    upperfirst: boolean;
    width: number | 'auto' | 'stretch';
    maxWidth: number | 'auto';
  }>;
  sort: Sort<InferAttributesOrigin<TRow, TDColumns>>;
  padding: Partial<{
    char: string;
    size: number;
  }>;
}>;

/**
 * Merges the given config with the default config.
 *
 * @param config the config
 * @returns the merged config
 */
export const mergeDefaultConfig = <TRow extends Row, TDColumns extends object>(
  config: Partial<Config<TRow, TDColumns>>
): Required<Config<TRow, TDColumns>> =>
  _merge(
    {
      align: 'LEFT',
      bgColorColumns: [],
      body: {
        subset: [],
        accumulation: {
          bgColor: '',
          columns: {},
          separator: '-'
        },
        bgColor: '',
        filterRow: null,
        highlightCell: {
          func: null,
          textColor: '#FFBA08'
        },
        highlightRow: {
          bgColor: '#FFBA08',
          func: null
        },
        precision: 3,
        striped: false,
        textColor: '',
        peek: 0
      },
      border: {
        color: '',
        groupSize: 1,
        horizontal: '',
        vertical: ''
      },
      header: {
        bgColor: '',
        bold: false,
        include: [],
        exclude: [],
        dynamic: {},
        italic: false,
        displayNames: {},
        origin: false,
        order: [],
        separator: '=',
        textColor: '',
        underline: false,
        uppercase: false,
        lowercase: false,
        upperfirst: false,
        width: 'auto',
        maxWidth: 'auto'
      },
      sort: {
        columns: [],
        directions: []
      },
      padding: {
        char: ' ',
        size: 2
      }
    },
    config
  );

/**
 * Merges the given config with the plain config.
 * The plain config removes all styling options.
 *
 * @param config the config
 * @returns the merged config
 */
export const mergePlainConfig = <TRow extends Row, TDColumns extends object>(
  config: Required<Config<TRow, TDColumns>>
): Required<Config<TRow, TDColumns>> =>
  _merge(config, {
    bgColorColumns: [],
    body: {
      calculated: {
        bgColor: ''
      },
      bgColor: '',
      highlightCell: {
        textColor: '',
        func: null
      },
      highlightRow: {
        bgColor: '',
        func: null
      },
      textColor: ''
    },
    border: {
      color: ''
    },
    header: {
      bgColor: '',
      bold: false,
      italic: false,
      textColor: '',
      underline: false
    }
  });
