import { Hono } from 'hono'

import { db } from '@/db'
import * as schema from '@/db/schema'
import { eq } from 'drizzle-orm'

import * as v from 'valibot';
import { vValidator } from '@hono/valibot-validator'
import { validationErrorHandler, newPostSchema, updatePostSchema } from '@lib/validators'

const app = new Hono()



app.get('/', async (c) => {
    const result = await db.select().from(schema.posts)
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
                .from(schema.posts)
                .where(eq(schema.posts.id, id));

            if (result.length === 0) {
                return c.json({ error: 'Post not found' }, 404);
            }

            return c.json(result[0]);

        } catch (err) {
            console.error(err);
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    })

app.post('/', vValidator('json', newPostSchema, validationErrorHandler), async (c) => {
    try {
        const validatedData = await c.req.valid('json')

        const newPost = await db.insert(schema.posts).values({
            id: crypto.randomUUID(),
            ...validatedData
        }).returning()

        return c.json(newPost[0], 201)
    } catch (err) {
        console.error(err)

        if (
            err.cause?.code === 'SQLITE_CONSTRAINT' &&
            err.cause.message.includes('UNIQUE constraint failed: posts.account_id, posts.shortcode')
        ) {
            return c.json({ error: 'This shortcode already exists for this account' }, 409);
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
        updatePostSchema,
        validationErrorHandler
    ),
    async (c) => {
        const { id } = c.req.valid('param')
        const validatedData = c.req.valid('json')

        if (Object.keys(validatedData).length === 0) {
            return c.json({ error: 'At least one field must be provided to update' }, 400);
        }

        try {
            const updatedPost = await db
                .update(schema.posts)
                .set(validatedData)
                .where(eq(schema.posts.id, id))
                .returning()

            if (updatedPost.length === 0) {
                return c.json({ error: 'Post not found' }, 404)
            }

            return c.json(updatedPost[0])
        } catch (err) {
            console.error(err)
            if (
                err.cause?.code === 'SQLITE_CONSTRAINT' &&
                err.cause.message.includes('UNIQUE constraint failed: posts.accountId, posts.shortcode')
            ) {
                return c.json({ error: 'This shortcode already exists for this account' }, 409);
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
            const deletedPost = await db
                .delete(schema.posts)
                .where(eq(schema.posts.id, id))
                .returning();

            if (deletedPost.length === 0) {
                return c.json({ error: 'Post not found' }, 404);
            }

            return c.json(deletedPost[0]);

        } catch (err) {
            console.error(err);
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    })

export default app