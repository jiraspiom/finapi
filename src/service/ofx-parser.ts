// src/services/ofx-parser.ts
import { parse } from 'ofx-js'

export interface OFXTransaction {
  id: string
  type: 'DEBIT' | 'CREDIT' | 'OTHER'
  date: Date
  amount: number
  description: string
  memo?: string
}

export interface OFXData {
  accountId?: string
  accountType?: string
  currency?: string
  balance?: number
  transactions: OFXTransaction[]
}

export async function parseOFX(fileContent: string): Promise<OFXData> {
  return new Promise((resolve, reject) => {
    parse(fileContent, (err: Error | null, data: any) => {
      if (err) {
        reject(new Error(`Erro ao processar OFX: ${err.message}`))
        return
      }

      try {
        const result: OFXData = { transactions: [] }

        // Extract statement
        const stmt =
          data?.OFX?.BANKMSGSRSV1?.STMTTRNRS?.STMTRS ||
          data?.OFX?.CREDITCARDMSGSRSV1?.CCSTMTTRNRS?.CCSTMTRS

        if (!stmt) {
          reject(new Error('Arquivo OFX inválido'))
          return
        }

        // Account info
        const acctInfo = stmt.BANKACCTFROM || stmt.CCACCTFROM
        if (acctInfo) {
          result.accountId = acctInfo.ACCTID
          result.accountType = acctInfo.ACCTTYPE || 'CHECKING'
        }

        // Balance
        if (stmt.LEDGERBAL) {
          result.balance = parseFloat(stmt.LEDGERBAL.BALAMT)
        }

        result.currency = stmt.CURDEF || 'BRL'

        // Transactions
        const txList = stmt.BANKTRANLIST || stmt.CCSTMTTRANLIST
        if (txList && txList.STMTTRN) {
          const transactions = Array.isArray(txList.STMTTRN)
            ? txList.STMTTRN
            : [txList.STMTTRN]

          result.transactions = transactions.map((tx: any) => ({
            id: tx.FITID || `${tx.DTPOSTED}_${tx.TRNAMT}`,
            type: parseFloat(tx.TRNAMT) >= 0 ? 'CREDIT' : 'DEBIT',
            date: parseOFXDate(tx.DTPOSTED),
            amount: Math.abs(parseFloat(tx.TRNAMT)),
            description: cleanDescription(tx.NAME || tx.MEMO || 'Transação'),
            memo: tx.MEMO || tx.NAME,
          }))
        }

        resolve(result)
      } catch (error: any) {
        reject(new Error(`Erro ao processar OFX: ${error.message}`))
      }
    })
  })
}

function parseOFXDate(dateStr: string): Date {
  const year = parseInt(dateStr.substring(0, 4))
  const month = parseInt(dateStr.substring(4, 6)) - 1
  const day = parseInt(dateStr.substring(6, 8))
  return new Date(year, month, day)
}

function cleanDescription(desc: string): string {
  return desc.replace(/\s+/g, ' ').trim().substring(0, 255)
}

export function categorizeTransaction(description: string): string {
  const desc = description.toLowerCase()

  if (/restaurante|lanchonete|mercado|supermercado|ifood|rappi/i.test(desc))
    return 'alimentacao'
  if (/uber|99|taxi|posto|combustivel|gasolina/i.test(desc)) return 'transporte'
  if (/farmacia|hospital|clinica|medic/i.test(desc)) return 'saude'
  if (/cinema|netflix|spotify|streaming/i.test(desc)) return 'lazer'
  if (/loja|shopping|magazine/i.test(desc)) return 'compras'

  return 'outros'
}
