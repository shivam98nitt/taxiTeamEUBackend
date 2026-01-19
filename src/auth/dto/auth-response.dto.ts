export class AuthResponseDto {
  accessToken: string;
  refreshToken: string;
  user: {
    id: number;
    name: string;
    email?: string;
    phone?: string;
    role: 'RIDER' | 'DRIVER' | 'ADMIN';
    is_active: boolean;
  };
  isNewUser: boolean;
}
