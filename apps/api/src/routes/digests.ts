import { Hono } from 'hono'

import { db } from '@/db'
import { digests, digestPosts } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

import * as v from 'valibot';
import { vValidator } from '@hono/valibot-validator'
import { validationErrorHandler, newDigestSchema, updateDigestSchema, digestPostsSchema } from '@lib/validators'

const app = new Hono()

app.get('/', async (c) => {
    const result = await db.select().from(digests)
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
            const result = await db.query.digests.findFirst({
                where: eq(digests.id, id),
                with: {
                    digestPosts: {
                        with: {
                            post: true // This will include the full post object
                        }
                    }
                }
            });

            if (!result) {
                return c.json({ error: 'Digest not found' }, 404);
            }

            return c.json(result);

        } catch (err) {
            console.error(err);
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    })

app.post('/', vValidator('json', newDigestSchema, validationErrorHandler), async (c) => {
    try {
        const validatedData = await c.req.valid('json')

        const newDigest = await db.insert(digests).values({
            id: crypto.randomUUID(),
            ...validatedData
        }).returning()

        return c.json(newDigest[0], 201)
    } catch (err) {
        console.error(err)

        return c.json({ error: 'Invalid request or database error' }, 500)
    }
})

app.post(
    '/:id/posts',
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
    vValidator('json', digestPostsSchema, validationErrorHandler),
    async (c) => {
        const { id: digestId } = c.req.valid('param')
        const { postIds } = c.req.valid('json')

        try {
            const values = postIds.map((postId) => ({
                digestId,
                postId
            }))

            const newDigestPosts = await db.transaction(async (tx) => {
                return await tx.insert(digestPosts)
                    .values(values)
                    .returning()
            });

            return c.json(newDigestPosts, 201)
        } catch (err) {
            console.error(err)

            if (
                err.cause?.code === 'SQLITE_CONSTRAINT' &&
                err.cause.message.includes('UNIQUE constraint')
            ) {
                return c.json({ error: 'One or more posts are already in this digest' }, 409);
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
        updateDigestSchema,
        validationErrorHandler
    ),
    async (c) => {
        const { id } = c.req.valid('param')
        const validatedData = c.req.valid('json')

        if (Object.keys(validatedData).length === 0) {
            return c.json({ error: 'At least one field must be provided to update' }, 400);
        }

        try {
            const updatedDigest = await db
                .update(digests)
                .set(validatedData)
                .where(eq(digests.id, id))
                .returning()

            if (updatedDigest.length === 0) {
                return c.json({ error: 'Digest not found' }, 404)
            }

            return c.json(updatedDigest[0])
        } catch (err) {
            console.error(err)
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
            const deletedDigest = await db
                .delete(digests)
                .where(eq(digests.id, id))
                .returning();

            if (deletedDigest.length === 0) {
                return c.json({ error: 'Digest not found' }, 404);
            }

            return c.json(deletedDigest[0]);

        } catch (err) {
            console.error(err);
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    })

app.delete(
    '/digests/:id/posts',
    vValidator(
        'param',
        v.object({
            id: v.pipe(
                v.string("ID is required"),
                v.uuid("Invalid Digest ID")
            )
        }),
        validationErrorHandler
    ),
    vValidator('json', digestPostsSchema, validationErrorHandler),

    async (c) => {
        const { id: digestId } = c.req.valid('param');
        const { postIds } = c.req.valid('json');

        try {
            const deletedRows = await db.delete(digestPosts)
                .where(
                    and(
                        eq(digestPosts.digestId, digestId),
                        inArray(digestPosts.postId, postIds)
                    )
                )
                .returning();

            if (deletedRows.length === 0) {
                return c.json({ error: 'No matching posts found in this digest' }, 404);
            }

            return c.json(deletedRows);

        } catch (err) {
            console.error(err);
            return c.json({ error: 'An unexpected error occurred' }, 500);
        }
    }
);

export default app