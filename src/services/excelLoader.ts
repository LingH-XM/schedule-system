let xlsxPromise: Promise<typeof import('xlsx')> | null = null
let excelJsPromise: Promise<typeof import('exceljs')['default']> | null = null
let fileSaverPromise: Promise<typeof import('file-saver')> | null = null

export function loadXlsx(): Promise<typeof import('xlsx')> {
  if (!xlsxPromise) xlsxPromise = import('xlsx')
  return xlsxPromise
}

export function loadExcelJs(): Promise<typeof import('exceljs')['default']> {
  if (!excelJsPromise) {
    excelJsPromise = import('exceljs').then((module) => module.default)
  }
  return excelJsPromise
}

export function loadFileSaver(): Promise<typeof import('file-saver')> {
  if (!fileSaverPromise) fileSaverPromise = import('file-saver')
  return fileSaverPromise
}
