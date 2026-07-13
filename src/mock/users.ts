export type MockUser = {
  accountId: string
  username: string
  password: string
  role: 'admin'
  name: string
}

export const mockUsers: MockUser[] = [
  {
    accountId: 'admin',
    username: 'admin',
    password: 'Admin@123456',
    role: 'admin',
    name: '系统管理员'
  }
]
