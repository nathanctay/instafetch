import { Hono } from 'hono'

import { db } from '@/db'
import * as schema from '@/db/schema'
import { eq } from 'drizzle-orm'

import * as v from 'valibot';
import { vValidator } from '@hono/valibot-validator'
import { validationErrorHandler, updateSettingsSchema } from '@lib/validators'

const app = new Hono()



app.get('/', async (c) => {
    try {
        const result = await db.select()
            .from(schema.settings)
            .where(eq(schema.settings.id, 1));

        if (result.length > 0) {
            return c.json(result[0]);
        }

        // 3. If NOT found, create it.
        const newSettings = await db.insert(schema.settings)
            .values({ id: 1 }) // This triggers all other defaults
            .returning();

        return c.json(newSettings[0]);
    } catch (err) {
        console.error(err);
        return c.json({ error: 'An unexpected error occurred' }, 500);
    }
})

app.patch(
    '/',
    vValidator(
        'json',
        updateSettingsSchema,
        validationErrorHandler
    ),
    async (c) => {
        const validatedData = c.req.valid('json')

        if (Object.keys(validatedData).length === 0) {
            return c.json({ error: 'At least one field must be provided to update' }, 400);
        }

        try {
            const updatedSettings = await db.update(schema.settings)
                .set(validatedData)
                .where(eq(schema.settings.id, 1))
                .returning()

            if (updatedSettings.length === 0) {
                return c.json({ error: 'Settings not found, try a GET first.' }, 404);
            }

            return c.json(updatedSettings[0])
        } catch (err) {
            console.error(err)
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    }
)
export default app