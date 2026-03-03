export type MockUser = {
  username: string
  password: string
  role: 'admin'
  name: string
}

export const mockUsers: MockUser[] = [
  {
    username: 'admin',
    password: 'Admin@123456',
    role: 'admin',
    name: '系统管理员'
  }
]
