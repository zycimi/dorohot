/*
 * @Description: 发信（nodemailer）——只被订阅功能使用
 *  所有超时都显式设置，避免 SMTP 卡住调度器。
 */
import nodemailer from 'nodemailer'

import type { SubscriptionSmtp } from './subscription'

export interface OutgoingMail {
  to: string
  subject: string
  text: string
  html: string
}

export async function sendMail(smtp: SubscriptionSmtp, mail: OutgoingMail) {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  })

  try {
    return await transporter.sendMail({
      from: smtp.from || smtp.user || smtp.host,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
  }
  finally {
    transporter.close()
  }
}
