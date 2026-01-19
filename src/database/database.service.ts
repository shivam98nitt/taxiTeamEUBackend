import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool ,QueryResult} from 'pg';

@Injectable()
export class DatabaseService
    implements OnModuleInit, OnModuleDestroy {
    private pool: Pool;

    constructor(private readonly config: ConfigService) { }

    onModuleInit() {
        this.pool = new Pool({
            host: this.config.get<string>('DB_HOST'),
            port: this.config.get<number>('DB_PORT'),
            user: this.config.get<string>('DB_USER'),
            password: this.config.get<string>('DB_PASSWORD'),
            database: this.config.get<string>('DB_NAME'),
        });
    }

    async query<T = any>(
        query: string,
        params: any[] = []
    ): Promise<QueryResult<T>> {
        const result = await this.pool.query(query, params);
        return result;
    }

    async getClient() : Promise<Pool.Client> {
        return await this.pool.connect();
    }

    async onModuleDestroy() {
        await this.pool.end();
    }
}
