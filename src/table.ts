import orderBy from 'lodash/orderBy';
import isNumber from 'lodash/isNumber';
import isInteger from 'lodash/isInteger';
import upperFirst from 'lodash/upperFirst';
import isFunction from 'lodash/isFunction';

import text2png from 'text2png';
import chalk, { Chalk } from 'chalk';
import { openSync, writeFileSync, OpenMode } from 'fs';

import { arrayIncludes, stringify } from './helper';
import { calculateAccumulation } from './accumulation';
import {
  Config,
  ImageExportConfig,
  InferAttributes,
  mergeDefaultConfig,
  mergeImageExportConfig,
  mergePlainConfig
} from './config';

/** borderLeft?, paddingLeft, text, paddingRight, borderRight? */
type CellContent = [string, string, string, string?, string?];

type BodyRowIndex = number;
type AccumulatedRowIndex = -1;
type RowIndex = AccumulatedRowIndex | BodyRowIndex;

function isAccumulatedRowIndex(arg: number): arg is AccumulatedRowIndex {
  return arg == -1;
}

export type Row = object | unknown[];

/**
 * Represent a dataset in tabular form.
 *
 * @typeParam TRow Type of a dataset row.
 * @typeParam TDColumns Type of the dynamic columns
 */
export class Table<TRow extends Row, TDColumns extends string = never> {
  /**
   * The dataset.
   */
  private _dataset: TRow[];

  /**
   * The table config.
   */
  private _config: Required<Config<TRow, TDColumns>>;

  /**
   * The row containing the accumulated data.
   */
  private accumulatedRow: Partial<TRow>;

  /**
   * The dynamic columns' data.
   */
  private dynamicColumns: Map<TDColumns, unknown[]> = new Map();

  /**
   * The column names.
   */
  private columnNames: string[] = [];

  /**
   * The maximum width of each column.
   */
  private columnWidths: Map<string, number> = new Map();

  /**
   * The table width.
   */
  private tableWidth: number;

  /**
   * A flag to check whether the header or body has changed since the last build.
   */
  private touched: boolean = true;

  /**
   * Creates a new `Table` instance.
   *
   * @param dataset the dataset
   * @param config the config
   */
  constructor(dataset: TRow[], config: Config<TRow, TDColumns> = {}) {
    this._config = mergeDefaultConfig(config);

    this.dataset = dataset;
    this.buildColumnNames();
  }

  public get dataset() {
    return this._dataset;
  }

  private set dataset(dataset: TRow[]) {
    const { body } = this._config;
    const { subset } = body;

    switch (subset.length) {
      case 1:
        this._dataset = dataset.slice(subset[0]);
        break;
      case 2:
        this._dataset = dataset.slice(...subset);
        break;
      default:
        this._dataset = dataset.slice();
    }

    this.touched = true;
  }

  public get config() {
    return this._config;
  }

  /**
   * Gets the value of the given cell in the dataset.
   *
   * @param row the cell's row
   * @param col the cell's col
   * @returns the cell's value
   */
  getDataCell(row: RowIndex, col: string | number) {
    const { header } = this.config;
    if (header.numeration && col === '#') return row;
    return this.dataset[row][col];
  }

  /**
   * Appends the given row to the dataset.
   *
   * @param row the row to append
   */
  appendRow(row: TRow) {
    this.dataset.push(row);
  }

  /**
   * Remove the given row from the dataset.
   *
   * @param row the row to remove
   */
  removeRow(row: RowIndex) {
    this.dataset.splice(row, 1);
  }

  /**
   * Prints the table to the console.
   *
   * @param clear clear the console before printing
   */
  print(clear: boolean = false) {
    if (clear) console.clear();
    // tslint:disable-next-line: no-console
    console.log(this.toString());
  }

  /**
   * Prints the plain (unstyled) table to the console.
   */
  printPlain() {
    // tslint:disable-next-line: no-console
    console.log(this.toPlainString());
  }

  /**
   * Gets the table as string.
   * Can be used to print the table on the console.
   *
   * @returns the table string
   */
  toString() {
    this.build();
    return this.buildHeader() + '\n' + this.buildBody();
  }

  /**
   * Gets the table as plain string without any advanced styling.
   * Can be used to write the table to a file or to paste it as text.
   *
   * @returns the plain table string
   */
  toPlainString() {
    const configBackup = this.config;
    this._config = {
      ...mergePlainConfig(this.config)
    };

    this.build(true);
    const res = this.buildHeader() + '\n' + this.buildBody();

    this._config = configBackup;

    return res;
  }

  /**
   * Exports the plain table to the given file (without advanced style).
   *
   * @param filepath the filepath
   * @param mode the file's open mode
   */
  exportFile(filepath: string, mode: OpenMode = 'w') {
    const fd = openSync(filepath, mode);
    writeFileSync(fd, this.toPlainString(), {
      encoding: 'utf-8'
    });
  }

  /**
   * Exports the plain table as .png file.
   *
   * @param filepath the filepath
   * @param config the image export config
   */
  exportImage(filepath: string, config: ImageExportConfig = {}) {
    const fd = openSync(filepath, 'w');
    writeFileSync(fd, text2png(this.toPlainString(), mergeImageExportConfig(config)), {
      encoding: 'utf-8'
    });
  }

  /**
   * Get the width of the console window.
   * Padding is substracted from the width.
   *
   * @returns the console width
   */
  private getConsoleWidth() {
    const { padding } = this.config;
    const numberOfCols = this.columnNames.length;
    return process.stderr.columns - numberOfCols * 2 * padding.size;
  }

  /**
   * Gets the character padding of the given size.
   *
   * @param size the padding size
   * @returns the character padding
   */
  private getPadding(size: number) {
    return this.config.padding.char.repeat(size);
  }

  /**
   * Checks whether the given text is a `border` character.
   *
   * @param text the text to check
   * @returns whether the text is a `border` character
   */
  private isBorder(text: string) {
    const { border } = this.config;
    return (
      (border.horizontal.length && text === border.horizontal) ||
      (border.vertical.length && text === border.vertical)
    );
  }

  /**
   * Sorts the dataset.
   */
  private sort() {
    const { columns, directions } = this.config.sort;
    if (columns.length !== directions.length)
      throw new Error(
        `Number of columns (${columns.length}) does not match number of directions (${directions.length})`
      );
    this.dataset = orderBy(this.dataset, columns, directions) as TRow[];
  }

  /**
   * Builds the column names from the dataset.
   * The result is stored in {@link Table.columnNames}
   */
  private buildColumnNames() {
    if (!this.dataset.length) return;

    const { header } = this.config;
    const { include, exclude, numeration } = header;

    const names = new Set<string>();

    if (numeration) names.add('#');

    // Column order
    for (const col of header.order) {
      names.add(String(col));
    }

    // Included columns / Columns from dataset without excluded
    if (include.length) for (const col of include) names.add(String(col));
    else
      Object.keys(this.dataset[0]).forEach((col) => {
        if (!arrayIncludes(exclude, col)) names.add(String(col));
      });

    // Names of dynamic columns
    for (const entry of header.dynamic) names.add(entry.name);

    this.columnNames = Array.from(names);
  }

  /**
   * Gets the raw text width of the given column.
   *
   * @param col the column
   * @returns the column's text width
   */
  private getColumnTextWidth(col: string | number) {
    const { header } = this.config;
    const colName = isNumber(col) ? this.columnNames[col] : col;
    if (isNumber(header.maxWidth)) return Math.min(this.columnWidths.get(colName), header.maxWidth);
    return this.columnWidths.get(colName);
  }

  /**
   * Gets the display name of the given column.
   *
   * @param col the column
   * @returns the column's display name
   */
  private getColumnDisplayName(col: string) {
    const { header } = this.config;
    const { displayNames } = header;
    return col in displayNames ? displayNames[col] : col;
  }

  /**
   * Calculates the width of all columns.
   * The result is stored in {@link Table.columnWidths}
   */
  private calculateColumnWidths() {
    const { header } = this.config;
    const widths = new Map<string, number>();

    const data = this.dataset.slice();
    const colNames = this.columnNames.slice();

    // Add dynamic column names => use a Set for faster lookup
    const dynamicColNames = new Set<string>(this.getDynamicColumnNames());
    colNames.push(...dynamicColNames.values());

    if (isNumber(header.width)) {
      // Fixed width
      for (const name of colNames) {
        if (name.length > header.width)
          throw new Error(`Column "${name}" is longer than max. column width (${header.width})`);
        widths.set(name, header.width);
      }
    } else {
      // Add accumulated row to dataset
      if (Object.keys(this.accumulatedRow).length) data.push(this.accumulatedRow as TRow);

      // Initalize with column text length
      for (const name of colNames) widths.set(name, this.getColumnDisplayName(name).length);

      // Search longest string / value
      for (const col of colNames) {
        // Dynamic column
        if (dynamicColNames.has(col)) {
          const values = this.dynamicColumns.get(col as TDColumns);
          for (const val of values)
            widths.set(col, Math.max(widths.get(col), this.parseCellText(val).length));
        } else {
          for (let iRow = 0; iRow < data.length; iRow++)
            widths.set(col, Math.max(widths.get(col), this.parseCellText(data[iRow][col]).length));
        }
      }

      if (header.numeration) widths.set('#', String(this.dataset.length).length || 1);

      const consoleWidth = this.getConsoleWidth();
      const widthSum = Array.from(widths.values()).reduce((prev, val) => prev + val, 0);

      // Calculate percentage
      if (
        header.width === 'stretch' ||
        (process.env.NODE_ENV !== 'test' && widthSum >= consoleWidth)
      )
        for (const key of widths.keys())
          widths.set(key, Math.floor((widths[key] / widthSum) * consoleWidth));
    }

    widths.keys().next();

    this.columnWidths = widths;
  }

  /**
   * Gets the names of the dynamic columns.
   *
   * @returns the dynamic columns names.
   */
  private getDynamicColumnNames() {
    return this.config.header.dynamic.map((col) => col.name);
  }

  /**
   * Calculates the data values for the each calculated column.
   *
   * @returns the calculated data values
   */
  private calculateDynamicColumns() {
    const { header } = this.config;
    const { dynamic } = header;

    const columns = new Map<TDColumns, unknown[]>();

    for (const col of dynamic) {
      const calculatedData = this.dataset.map((row, i) => col.func(row, i));
      columns.set(col.name, calculatedData);
    }

    return columns;
  }

  /**
   * Gets the index of the given column.
   *
   * @param col the column's name
   * @returns the column's index
   */
  private getColumnIndex(col: string | TDColumns) {
    const cols = this.columnNames;
    const dynamics = this.getDynamicColumnNames();

    if (dynamics.includes(col as TDColumns))
      return dynamics.findIndex((name) => name === col) + cols.length;

    return cols.findIndex((name) => name === col);
  }

  /**
   * Builds the row separator.
   *
   * @param separator the separator character
   * @returns the row separator string
   */
  private buildRowSeparator(separator: string) {
    return separator.repeat(this.tableWidth) + '\n';
  }

  /**
   * Computes the values of the accumulated columns.
   *
   * @returns the computed row values
   */
  private calculateAccumulation() {
    const { accumulation } = this.config.body;
    const { columns } = accumulation;

    if (!columns.length) return {};

    // Add dynamic column names => use a Set for faster lookup
    const dynamicColNames = new Set<string>(this.getDynamicColumnNames());

    // TODO: Might be exported to its own type
    const values: {
      [K in InferAttributes<TRow> | TDColumns]: unknown[];
    } = {} as {
      [K in InferAttributes<TRow> | TDColumns]: unknown[];
    };

    // Initalize empty arrays
    for (const comp of columns) values[comp.column] = [];

    // Collect row data
    for (let iRow = 0; iRow < this.dataset.length; iRow++) {
      const row = this.dataset[iRow];
      for (const col of columns) {
        if (dynamicColNames.has(String(col.column)))
          values[col.column].push(this.dynamicColumns.get(col.column as TDColumns)[iRow]);
        else values[col.column].push(row[col.column as string]);
      }
    }

    // Calculate
    for (const comp of columns)
      values[comp.column as string] = calculateAccumulation(values[comp.column], comp.func);

    return values;
  }

  /**
   * Builds a cell content array.
   *
   * @param padLeft the cell's left padding
   * @param text the cell's text
   * @param padRight the cell's right padding
   * @returns the cell content
   */
  private buildCellContent(padLeft: number, text: string, padRight: number): CellContent {
    return [this.getPadding(padLeft), text, this.getPadding(padRight)];
  }

  /**
   * Builds an empty cell content.
   *
   * @param col the cell's column
   * @returns the empty cell content
   */
  private buildEmptyCellContent(col: string | number) {
    const { padding } = this.config;
    return this.buildCellContent(
      padding.size,
      this.getPadding(this.getColumnTextWidth(col)),
      padding.size
    );
  }

  /**
   * Parses the given cell text to `String`.
   *
   * @param text the text to parse
   * @returns the parsed cell text
   */
  private parseCellText(text: unknown) {
    if (isNumber(text) && !isInteger(text)) return text.toFixed(this.config.body.precision);
    return stringify(text);
  }

  /**
   * Gets the text of given the given cell.
   *
   * @param row the cell's row
   * @param col the cell's column
   * @param cropped whether the text should be cropped or not.
   * @returns the cell text
   */
  private getCellText(row: RowIndex, col: string, cropped: boolean = true) {
    let text = '';

    if (isAccumulatedRowIndex(row)) text = this.parseCellText(this.accumulatedRow[col]);
    else if (col === '#') text = this.parseCellText(row);
    else if (Array.from(this.dynamicColumns.keys()).includes(col as TDColumns))
      text = this.parseCellText(this.dynamicColumns.get(col as TDColumns)[row]);
    else text = this.parseCellText(this.getDataCell(row, col));

    if (cropped) text = text.substring(0, this.getColumnTextWidth(col));

    return text;
  }

  /**
   * Calculates the header cell padding.
   *
   * @param col the cell's column
   * @returns the cell padding
   */
  private calculateHeaderCellPadding(col: string) {
    const { padding } = this.config;
    return this.getColumnTextWidth(col) - this.getColumnDisplayName(col).length + padding.size;
  }

  /**
   * Formats the content of the given header cell.
   *
   * @param col cell's column
   * @param content cell's content
   * @returns the formatted cell content and its text length
   */
  private formatHeaderCellContent(col: string, content: CellContent): [string, number] {
    const { bgColorColumns, border, header } = this.config;
    const { bgColor, bold, italic, lowercase, textColor, underline, uppercase, upperfirst } =
      header;

    const colIndex = this.getColumnIndex(col);
    const contentCopy: CellContent = [...content];

    if (border.vertical.length) {
      if (colIndex === 0) contentCopy.unshift(border.vertical); // left border
      contentCopy.push(border.vertical); // right border
    }

    // Index of the header cell's text inside content tuple
    const textIndex = contentCopy.length === 5 ? 2 : 1;

    /**
     * Apply header cell styling:
     *  - background color
     *  - border color
     *  - text color
     *  - text / font style
     */

    let cellContent = '';
    let cellContentLen = 0;

    for (let i = 0; i < contentCopy.length; i++) {
      let text = contentCopy[i];
      let styled: Chalk = chalk;

      // Background
      if (bgColorColumns.length) {
        styled = styled.bgHex(bgColorColumns[colIndex % bgColorColumns.length]);
      } else if (bgColor.length) {
        styled = styled.bgHex(bgColor);
      }

      if (this.isBorder(text) && border.color.length) styled.hex(border.color);
      else if (i === textIndex) {
        // Text color
        if (textColor.length) styled = styled.hex(textColor);

        if (uppercase) text = text.toUpperCase();
        else if (lowercase) text = text.toLowerCase();
        else if (upperfirst) text = upperFirst(text);

        // Font style
        if (bold) styled = styled.bold;
        if (italic) styled = styled.italic;
        if (underline) styled = styled.underline;
      }

      cellContentLen += text.length;
      cellContent += styled(text);
    }

    return [cellContent, cellContentLen];
  }

  /**
   * Builds the given header cell content.
   *
   * @param col the cell's column
   * @returns the cell content and its text length
   */
  private buildHeaderCell(col: string): [string, number] {
    const { align, padding } = this.config;

    let content: CellContent;
    const displayName = this.getColumnDisplayName(col);

    switch (align) {
      case 'CENTER':
        const toFill = this.getColumnTextWidth(col) - displayName.length;
        const lrPadding = Math.floor(toFill / 2) + padding.size;
        content = this.buildCellContent(lrPadding, displayName, lrPadding + (toFill % 2 ? 1 : 0));
        break;

      case 'RIGHT':
        const lPadding = this.calculateHeaderCellPadding(col);
        content = this.buildCellContent(lPadding, displayName, padding.size);
        break;

      default:
        const rPadding = this.calculateHeaderCellPadding(col);
        content = this.buildCellContent(padding.size, displayName, rPadding);
    }

    return this.formatHeaderCellContent(col, content);
  }

  /**
   * Builds the header.
   *
   * @returns the header content
   */
  private buildHeader() {
    const { header } = this.config;

    let content = '';
    let contentLen = 0;

    for (const col of this.columnNames) {
      const [res, len] = this.buildHeaderCell(col);
      content += res;
      contentLen += len;
    }

    this.tableWidth = contentLen;

    content += '\n' + header.separator.repeat(contentLen);

    return content;
  }

  /**
   * Calculates the body cell padding.
   *
   * @param row the cell's row
   * @param col the cell's column
   * @returns the cell padding
   */
  private calculateBodyCellPadding(row: RowIndex, col: string) {
    const { padding } = this.config;
    return this.getColumnTextWidth(col) - this.getCellText(row, col).length + padding.size;
  }

  /**
   * Formats the content of the given body cell.
   *
   * @param row the cell's row
   * @param col the cell's column
   * @param content the cell's content
   * @returns the formatted cell content
   */
  private formatBodyCellContent(row: RowIndex, col: string, content: CellContent) {
    const { bgColorColumns, body, border } = this.config;
    const { accumulation, highlightCell, textColor } = body;

    const colIndex = this.getColumnIndex(col);
    const contentCopy: CellContent = [...content];

    if (border.vertical.length) {
      if (colIndex === 0) contentCopy.unshift(border.vertical); // left border
      contentCopy.push(border.vertical); // right border
    }

    // Index of the body cell's text inside content tuple
    const textIndex = contentCopy.length === 5 ? 2 : 1;

    let cellContent = '';
    for (let i = 0; i < contentCopy.length; i++) {
      const text = contentCopy[i];

      // Calculated row
      if (isAccumulatedRowIndex(row) && accumulation.bgColor.length) {
        cellContent += chalk.bgHex(accumulation.bgColor)(text);
        continue;
      }

      /**
       * Apply body cell styling:
       *  - background color
       *  - border color
       *  - text color
       */

      let styled: Chalk = chalk;

      // Column background
      if (bgColorColumns.length)
        styled = chalk.bgHex(bgColorColumns[colIndex % bgColorColumns.length]);

      if (this.isBorder(text) && border.color.length) styled = styled.hex(border.color);
      else if (i === textIndex) {
        if (textColor.length) styled = styled.hex(textColor);

        // Highlight value
        if (
          isFunction(highlightCell.func) &&
          highlightCell.func(
            this.getDataCell(row, col),
            row,
            col as InferAttributes<TRow, TDColumns>
          )
        )
          styled = styled.hex(highlightCell.textColor);
      }

      cellContent += styled(text);
    }

    return cellContent;
  }

  /**
   * Builds the given body cell content.
   *
   * @param row the cell's row
   * @param col the cell's column
   * @returns the cell content
   */
  private buildBodyCell(row: RowIndex, col: string) {
    const { align, padding } = this.config;

    let content: CellContent;

    const cellText = this.getCellText(row, col);
    const overflow = this.getCellText(row, col, false).substring(this.getColumnTextWidth(col));

    switch (align) {
      case 'CENTER':
        const toFill = this.getColumnTextWidth(col) - cellText.length;
        const lrPadding = Math.floor(toFill / 2) + padding.size;
        content = this.buildCellContent(lrPadding, cellText, lrPadding + (toFill % 2 ? 1 : 0));
        break;

      case 'RIGHT':
        const lPadding = this.calculateBodyCellPadding(row, col);
        content = this.buildCellContent(lPadding, cellText, padding.size);
        break;

      default:
        const rPadding = this.calculateBodyCellPadding(row, col);
        content = this.buildCellContent(padding.size, cellText, rPadding);
    }

    return [this.formatBodyCellContent(row, col, content), overflow];
  }

  /**
   * Formats the content of the given body row.
   *
   * @param row the cell's row
   * @param content the rows's content
   * @returns the formatted row content
   */
  private formatBodyRowContent(row: RowIndex, content: string) {
    const { bgColor, highlightRow, striped } = this.config.body;

    // Background color
    if (isFunction(highlightRow.func) && highlightRow.func(this.dataset[row], row))
      return chalk.bgHex(highlightRow.bgColor)(content);

    if (striped && row % 2)
      return (bgColor.length ? chalk.bgHex(bgColor) : chalk.bgHex('#444444'))(content);

    if (bgColor.length) return chalk.bgHex(bgColor)(content);

    return chalk(content);
  }

  /**
   * Builds the horizontal border for the given row.
   *
   * @param row the row
   * @returns the horizontal row border
   */
  private buildBodyRowHorizontalBorder(row: RowIndex) {
    const { border } = this.config;
    const { color, groupSize, horizontal } = border;

    let res =
      horizontal.length && row < this.dataset.length - 1 && (row + 1) % groupSize === 0
        ? this.buildRowSeparator(horizontal)
        : '';

    if (color && res.length) res = chalk.hex(color)(res);

    return res;
  }

  /**
   * Builds the given body row.
   *
   * @param row the row
   * @returns the row content
   */
  private buildBodyRow(row: RowIndex) {
    let content = '';
    let hasOverflow = false;
    const colsOverflow: string[] = [];

    for (const name of this.columnNames) {
      const [str, overflow] = this.buildBodyCell(row, name);
      content += str;
      colsOverflow.push(overflow);
      if (overflow.length) hasOverflow = true;
    }

    if (hasOverflow) content += this.buildBodyRowOverflow(row, colsOverflow);

    const formattedContent = this.formatBodyRowContent(row, content) + '\n';
    const hzBorder = this.buildBodyRowHorizontalBorder(row);

    return formattedContent + hzBorder;
  }

  /**
   * Builds the subsequent lines (overflow) of the given row.
   *
   * @param row the initial row
   * @param overflow the text overflow
   * @returns the subsequent lines
   */
  private buildBodyRowOverflow(row: RowIndex, overflow: string[]) {
    const { align, padding } = this.config;

    let content = '\n';
    let hasMore = false;

    for (let i = 0; i < overflow.length; i++) {
      const colName = this.columnNames[i];
      const colWidth = this.getColumnTextWidth(colName);
      const text = overflow[i].substring(0, colWidth);

      if (!text.length)
        content += this.formatBodyCellContent(row, colName, this.buildEmptyCellContent(colName));
      else {
        switch (align) {
          case 'CENTER':
            const toFill = colWidth - text.length;
            const lrPadding = Math.floor(toFill / 2) + padding.size;
            content += this.formatBodyCellContent(
              row,
              colName,
              this.buildCellContent(lrPadding, text, lrPadding + (toFill % 2 ? 1 : 0))
            );
            break;

          case 'RIGHT':
            content += this.formatBodyCellContent(
              row,
              colName,
              this.buildCellContent(colWidth - text.length + padding.size, text, padding.size)
            );
            break;

          default:
            content += this.formatBodyCellContent(
              row,
              colName,
              this.buildCellContent(padding.size, text, colWidth - text.length + padding.size)
            );
        }

        overflow[i] = overflow[i].substring(colWidth);
        if (overflow[i].length) hasMore = true;
      }
    }

    if (hasMore) content += this.buildBodyRowOverflow(row, overflow);

    return content;
  }

  /**
   * Builds the body.
   *
   * @returns the body content
   */
  private buildBody() {
    const { body } = this.config;

    let content = this.dataset.reduce((prev, __, i) => prev + this.buildBodyRow(i), '');

    // Row of accumulation results
    if (body.accumulation.columns.length)
      content += this.buildRowSeparator(body.accumulation.separator) + this.buildBodyRow(-1);

    // Remove last linebreak (\n)
    if (content.charCodeAt(content.length - 1) === 10)
      content = content.substring(0, content.length - 1);

    return content;
  }

  /**
   * Builds the table.
   * For performance reasons the table is only built if {@link Table.touched} is `true`.
   *
   * @param force force the build
   */
  private build(force: boolean = false) {
    if (this.touched || force) {
      this.dynamicColumns = this.calculateDynamicColumns();
      this.accumulatedRow = this.calculateAccumulation();
      this.calculateColumnWidths();
      if (this.config.sort.columns.length) this.sort();
    }
    this.touched = false;
  }
}
