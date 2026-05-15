// src/utils/ofx-parser.ts

import iconv from 'iconv-lite'

export type OfxTransaction = {
  type: 'INCOME' | 'EXPENSE'
  amount: number
  rawAmount: number
  fitId: string
  memo: string
  date: Date
  rawType: string
}

function extractTag(block: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i')
  const match = block.match(regex)

  return match?.[1]?.trim() ?? ''
}

function parseOfxDate(ofxDate: string): Date {
  const clean = ofxDate.split('[')[0].replace(/\D/g, '')

  const year = clean.slice(0, 4)
  const month = clean.slice(4, 6)
  const day = clean.slice(6, 8)
  const hour = clean.slice(8, 10) || '00'
  const minute = clean.slice(10, 12) || '00'
  const second = clean.slice(12, 14) || '00'

  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`)
}

export async function parseOfxFile(file: File): Promise<OfxTransaction[]> {
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // OFX brasileiro geralmente vem latin1/windows-1252
  let text = iconv.decode(buffer, 'latin1')

  // Remove caracteres inválidos
  // text = text.replace(/\u0000/g, '')
  text = text.split('\0').join('')

  // Extrai blocos de transação
  const blocks = text.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi) ?? []

  return blocks.map(block => {
    const rawAmount = Number(extractTag(block, 'TRNAMT'))
    const rawType = extractTag(block, 'TRNTYPE')
    const fitId = extractTag(block, 'FITID') || crypto.randomUUID()

    const memo =
      extractTag(block, 'MEMO') ||
      extractTag(block, 'NAME') ||
      'Transação importada'

    const dateRaw = extractTag(block, 'DTPOSTED')

    return {
      type: rawAmount >= 0 ? 'INCOME' : 'EXPENSE',
      amount: Math.abs(rawAmount),
      rawAmount,
      fitId,
      memo,
      rawType,
      date: parseOfxDate(dateRaw),
    }
  })
}
