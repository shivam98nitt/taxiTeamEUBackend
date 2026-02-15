import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';


@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) { }

  // 1️⃣ Request OTP
  async requestOtp(phone: string) {
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
    const otpHash = await bcrypt.hash(otp, 10);
    phone = phone.replace(/\s+/g, ''); // Remove spaces
    const expiresAt = new Date(Date.now() + 1 * 60 * 1000); // 5 minutes

    await this.db.query(
      `
      INSERT INTO otp_verifications (phone, otp_hash, expires_at, attempts_left)
      VALUES ($1, $2, $3, 5)
      ON CONFLICT (phone)
      DO UPDATE SET
        otp_hash = EXCLUDED.otp_hash,
        expires_at = EXCLUDED.expires_at,
        attempts_left = 3
      `,
      [phone, otpHash, expiresAt],
    );

    // TEMP: log OTP (remove when SMS integrated)
    this.logger.debug(`OTP for ${phone}: ${otp}`);
    // this.sendOtpNotification(phone, otp).catch(err => {
    //   console.error('Failed to send OTP SMS', err);
    // });

    return {
      success: true,
      expires_in_seconds: 60,
    };
  }

  sendOtpNotification = async (phone: string, otp:string) => {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.messages.create({
      body: `Your OTP for EU Taxi is ${otp}. It is valid for 2 minutes.`,
      to: phone, // ✅ must be in E.164 format (e.g. +9198xxxxxxxx)
      from: process.env.TWILIO_PHONE_NUMBER,
    });
  }

  // 2️⃣ Verify OTP
  async verifyOtp(phone: string, otp: string) {
    phone = phone.replace(/\s+/g, ''); // Remove spaces
    const result = await this.db.query(
      `SELECT * FROM otp_verifications WHERE phone = $1`,
      [phone],
    );

    if (result.rowCount === 0) {
      throw new BadRequestException('OTP expired or not found');
    }

    const record = result.rows[0];

    if (record.expires_at < new Date()) {
      await this.db.query(`DELETE FROM otp_verifications WHERE phone = $1`, [
        phone,
      ]);
      throw new BadRequestException('OTP expired');
    }

    if (record.attempts_left <= 0) {
      await this.db.query(`DELETE FROM otp_verifications WHERE phone = $1`, [
        phone,
      ]);
      throw new BadRequestException('Too many invalid attempts');
    }

    const isValid = await bcrypt.compare(otp, record.otp_hash);

    if (!isValid) {
      await this.db.query(
        `
        UPDATE otp_verifications
        SET attempts_left = attempts_left - 1
        WHERE phone = $1
        `,
        [phone],
      );
      throw new BadRequestException('Invalid OTP');
    }

    // OTP success → delete OTP
    await this.db.query(`DELETE FROM otp_verifications WHERE phone = $1`, [
      phone,
    ]);

    // Find or create user
    const userResult = await this.db.query(
      `SELECT * FROM users WHERE phone = $1`,
      [phone],
    );

    let user;

    if (userResult.rowCount === 0) {
      const insertResult = await this.db.query(
        `
        INSERT INTO users (phone, role, onboarding_completed)
        VALUES ($1, 'RIDER', false)
        RETURNING *
        `,
        [phone],
      );
      user = insertResult.rows[0];
    } else {
      user = userResult.rows[0];
    }

    const tokens = await this.generateTokens(user);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user,
    };
  }

  // Generate JWT
  private async generateTokens(user: any) {
    const payload = {
      sub: user.id,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES'),
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days (keep in sync with env)
    );

    await this.db.query(
      `
    INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id)
    DO UPDATE SET
      token_hash = EXCLUDED.token_hash,
      expires_at = EXCLUDED.expires_at,
      revoked = false
    `,
      [user.id, refreshTokenHash, expiresAt],
    );

    return { accessToken, refreshToken };
  }

  // 3️⃣ Refresh Token
  async refreshToken(refreshToken: string) {
    let payload: any;

    try {
      payload = this.jwtService.verify(refreshToken);
    } catch {
      throw new BadRequestException('Invalid refresh token');
    }

    const tokenResult = await this.db.query(
      `
    SELECT * FROM refresh_tokens
    WHERE user_id = $1 AND revoked = false
    `,
      [payload.sub],
    );

    if (tokenResult.rowCount === 0) {
      throw new BadRequestException('Refresh token not found');
    }

    const record = tokenResult.rows[0];

    if (record.expires_at < new Date()) {
      throw new BadRequestException('Refresh token expired');
    }

    const isMatch = await bcrypt.compare(refreshToken, record.token_hash);

    if (!isMatch) {
      throw new BadRequestException('Invalid refresh token');
    }

    const newAccessToken = this.jwtService.sign({
      sub: payload.sub,
      role: payload.role,
    });

    return {
      access_token: newAccessToken,
    };
  }

  // 4️⃣ Logout
  async logout(userId: number) {
    await this.db.query(
      `
    UPDATE refresh_tokens
    SET revoked = true
    WHERE user_id = $1
    `,
      [userId],
    );

    return { success: true };
  }
}
