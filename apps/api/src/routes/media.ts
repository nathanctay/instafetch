import { Hono } from 'hono'

import { db } from '@/db'
import { media } from '@/db/schema'
import { eq } from 'drizzle-orm'

import * as v from 'valibot';
import { vValidator } from '@hono/valibot-validator'
import { validationErrorHandler } from '@lib/validators'

const app = new Hono()



app.get('/', async (c) => {
    const result = await db.select().from(media)
    return c.json(result)
})

app.get(
    '/:id',
    vValidator(
        'param',
        v.object({
            id: v.pipe(
                v.string("ID is required"),
                v.uuid("Invalid ID")
            )
        }),
        validationErrorHandler
    ),
    async (c) => {
        const { id } = c.req.valid('param')

        try {
            const result = await db.select()
                .from(media)
                .where(eq(media.id, id));

            if (result.length === 0) {
                return c.json({ error: 'Media not found' }, 404);
            }

            return c.json(result[0]);

        } catch (err) {
            console.error(err);
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    })


export default app