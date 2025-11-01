import * as v from 'valibot';
import * as schema from '@/db/schema'

export const validationErrorHandler = (result, c) => {
    if (!result.success) {
        const issues = result.issues.map(issue => ({
            field: issue.path?.map(p => p.key).join('.'),
            message: issue.message
        }));
        return c.json({ error: "Validation failed", issues: issues }, 400);
    }
};

export const paginationSchema = v.object({
    page: v.optional(
        v.pipe(
            v.string(),
            v.transform(Number),
            v.pipe(
                v.number(),
                v.minValue(1, "Page must be at least 1")
            )
        ),
        "1"
    ),
    limit: v.optional(
        v.pipe(
            v.string(),
            v.transform(Number),
            v.pipe(
                v.number(),
                v.minValue(1, "Limit must be at least 1"),
                v.maxValue(100, "Limit cannot be more than 100")
            )
        ),
        "20"
    ),
})

//accounts
export const newAccountSchema = v.object({
    handle: v.pipe(
        v.string("Handle is required"),
        v.nonEmpty("Handle cannot be empty"),
        v.maxLength(30, "Handle is too long"),
        v.regex(/^[A-Za-z0-9._]+$/, "Handle cannot contain special characters or spaces")
    ),
    url: v.pipe(
        v.string("url is required"),
        v.url("Must be a valid url"),
        v.nonEmpty("URL cannot be empty"),
    ),
    status: v.pipe(
        v.optional(
            v.picklist(schema.accounts.status.enumValues, "Invalid status. Must be one of: active, paused, or error."),
            "active"
        )
    )
})

export const updateAccountSchema = v.object({
    handle: v.optional(v.pipe(
        v.string("Handle is required"),
        v.nonEmpty("Handle cannot be empty"),
        v.maxLength(30, "Handle is too long"),
        v.regex(/^[A-Za-z0-9._]+$/, "handle cannot contain special characters or spaces")
    )),
    url: v.optional(v.pipe(
        v.string("url is required"),
        v.url("Must be a valid url"),
        v.nonEmpty("URL cannot be empty"),
    )),
    status: v.optional(v.pipe(
        v.optional(
            v.picklist(schema.accounts.status.enumValues, "Invalid status. Must be one of: active, paused, or error."),
            "active"
        )
    )),

})


//digests
export const newDigestSchema = v.object({
    sentAt: v.pipe(
        v.string("sentAt must be a valid date"),
        v.isoTimestamp("publishedAt must be a valid ISO timestamp"),
        v.transform((input) => new Date(input))
    ),
    periodStart: v.pipe(
        v.string("periodStart must be a valid date"),
        v.isoTimestamp("periodStart must be a valid ISO timestamp"),
        v.transform((input) => new Date(input))
    ),
    periodEnd: v.pipe(
        v.string("periodEnd must be a valid date"),
        v.isoTimestamp("periodEnd must be a valid ISO timestamp"),
        v.transform((input) => new Date(input))
    ),
})

export const updateDigestSchema = v.object({
    sentAt: v.optional(v.pipe(
        v.string("sentAt must be a valid date"),
        v.isoTimestamp("sentAt must be a valid ISO timestamp"),
        v.transform((input) => new Date(input))
    )),
    periodStart: v.optional(v.pipe(
        v.string("periodStart must be a valid date"),
        v.isoTimestamp("periodStart must be a valid ISO timestamp"),
        v.transform((input) => new Date(input))
    )),
    periodEnd: v.optional(v.pipe(
        v.string("periodEnd must be a valid date"),
        v.isoTimestamp("periodEnd must be a valid ISO timestamp"),
        v.transform((input) => new Date(input))
    )),

})

//digest Posts
export const digestPostsSchema = v.object({
    postIds:
        v.pipe(
            v.array(
                v.pipe(
                    v.string("Post ID is required"),
                    v.uuid("Invalid Post ID")
                )
            ),
            v.nonEmpty("postIds array cannot be empty"))
})

//posts
export const newPostSchema = v.object({
    accountId: v.pipe(
        v.string("Account ID is required"),
        v.uuid("Invalid Acccount ID"),
    ),
    shortcode: v.pipe(
        v.string("Shortcode is required"),
        v.nonEmpty("Shortcode cannot be empty"),
    ),
    // publishedAt: v.date("publishedAt must be a valid date"),
    publishedAt: v.pipe(
        v.string("publishedAt must be a valid date"),
        v.isoTimestamp("publishedAt must be a valid ISO timestamp"),
        v.transform((input) => new Date(input))
    ),
    caption: v.optional(
        v.string()
    ),
    raw: v.optional(
        v.string()
    ),
})

export const updatePostSchema = v.object({
    shortcode: v.optional(
        v.pipe(
            v.string("Shortcode is required"),
            v.nonEmpty("Shortcode cannot be empty"),
        )
    ),
    // publishedAt: v.optional(
    //     v.date("publishedAt must be a valid date")
    // ),
    publishedAt: v.optional(
        v.pipe(
            v.string("publishedAt must be a valid date"),
            v.isoTimestamp("publishedAt must be a valid ISO timestamp"),
            v.transform((input) => new Date(input))
        )
    ),
    caption: v.optional(
        v.string()
    ),
    raw: v.optional(
        v.string()
    ),
})

// media


//settings

export const updateSettingsSchema = v.object({
    digestFrequency: v.optional(
        v.picklist(schema.settings.digestFrequency.enumValues, "Invalid frequency. Must be daily or weekly.")
    ),
    instantAlerts: v.optional(
        v.boolean()
    )
})