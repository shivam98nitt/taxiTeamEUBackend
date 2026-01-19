import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async completeOnboarding(userId: number, dto: OnboardingDto) {
    const result = await this.db.query(
      `
    UPDATE users
    SET
      name = $1,
      email = $2,
      gender = COALESCE($3, gender),
      age = COALESCE($4, age),
      onboarding_completed = true
    WHERE id = $5
    RETURNING *
    `,
      [dto.name, dto.email, dto.gender ?? null, dto.age ?? null, userId],
    );

    return result.rows[0];
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const fields: string[] = [];
    const values: any[] = [];
    let index = 1;

    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        fields.push(`${key} = $${index++}`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      return null; // nothing to update
    }

    const query = `
    UPDATE users
    SET ${fields.join(', ')}
    WHERE id = $${index}
    RETURNING *
  `;

    values.push(userId);

    const result = await this.db.query(query, values);
    return result.rows[0];
  }
}
