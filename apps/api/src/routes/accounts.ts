import { Hono } from 'hono'

import { db } from '@/db'
import * as schema from '@/db/schema'
import { eq } from 'drizzle-orm'

import * as v from 'valibot';
import { vValidator } from '@hono/valibot-validator'
import { validationErrorHandler, newAccountSchema, updateAccountSchema } from '@lib/validators'

const app = new Hono()

app.get('/', async (c) => {
    const result = await db.select().from(schema.accounts)
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
                .from(schema.accounts)
                .where(eq(schema.accounts.id, id));

            if (result.length === 0) {
                return c.json({ error: 'Account not found' }, 404);
            }

            return c.json(result[0]);

        } catch (err) {
            console.error(err);
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    })

app.post('/', vValidator('json', newAccountSchema, validationErrorHandler), async (c) => {
    try {
        const validatedData = await c.req.valid('json')

        const newAccount = await db.insert(schema.accounts).values({
            id: crypto.randomUUID(),
            ...validatedData
        }).returning()

        return c.json(newAccount[0], 201)
    } catch (err) {
        console.error(err)

        if (
            err.cause?.code === 'SQLITE_CONSTRAINT' &&
            err.cause.message.includes('UNIQUE constraint failed')
        ) {
            return c.json({ error: 'This handle is already added' }, 409)
        }

        return c.json({ error: 'Invalid request or database error' }, 500)
    }
})

app.patch(
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
    vValidator(
        'json',
        updateAccountSchema,
        validationErrorHandler
    ),
    async (c) => {
        const { id } = c.req.valid('param')
        const validatedData = c.req.valid('json')

        if (Object.keys(validatedData).length === 0) {
            return c.json({ error: 'At least one field must be provided to update' }, 400);
        }

        try {
            const updatedAccount = await db
                .update(schema.accounts)
                .set(validatedData)
                .where(eq(schema.accounts.id, id))
                .returning()

            if (updatedAccount.length === 0) {
                return c.json({ error: 'Account not found' }, 404)
            }

            return c.json(updatedAccount[0])
        } catch (err) {
            console.error(err)
            if (
                err.cause?.code === 'SQLITE_CONSTRAINT' &&
                err.cause.message.includes('UNIQUE constraint failed')
            ) {
                return c.json({ error: 'This handle is already added' }, 409);
            }
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    }
)

app.delete(
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
            const deletedAccount = await db
                .delete(schema.accounts)
                .where(eq(schema.accounts.id, id))
                .returning();

            if (deletedAccount.length === 0) {
                return c.json({ error: 'Account not found' }, 404);
            }

            return c.json(deletedAccount[0]);

        } catch (err) {
            console.error(err);
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    })

export default app