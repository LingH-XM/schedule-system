import { ElNotification } from 'element-plus'

type NotifyType = 'success' | 'warning' | 'error' | 'info'

function push(type: NotifyType, message: string, title?: string): void {
  ElNotification({
    type,
    title:
      title ??
      (type === 'success'
        ? '成功'
        : type === 'warning'
          ? '提示'
          : type === 'error'
            ? '错误'
            : '通知'),
    message,
    position: 'top-right',
    duration: type === 'error' ? 3500 : 2500
  })
}

export const notify = {
  success(message: string, title?: string): void {
    push('success', message, title)
  },
  warning(message: string, title?: string): void {
    push('warning', message, title)
  },
  error(message: string, title?: string): void {
    push('error', message, title)
  },
  info(message: string, title?: string): void {
    push('info', message, title)
  }
}
