import {defineArrayMember, defineField, defineType} from 'sanity'

export const gallery = defineType({
  name: 'gallery',
  title: 'Gallery',
  type: 'object',
  fields: [
    defineField({
      name: 'name',
      title: 'Gallery name',
      type: 'localeString',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'type',
      title: 'Gallery type',
      description: 'How this gallery should be displayed on the site. More types will be added later.',
      type: 'string',
      options: {
        list: [
          {title: 'Photo stripe', value: 'photoStripe'},
          {title: 'Photo horizontal', value: 'photoHorizontal'},
          {title: 'Photo column', value: 'photoColumn'},
        ],
        layout: 'radio',
      },
      initialValue: 'photoStripe',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'images',
      title: 'Images',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'image',
          options: {hotspot: true},
          fields: [
            defineField({
              name: 'caption',
              title: 'Caption',
              description: 'Optional per-photo credit/caption shown on hover. Falls back to the gallery name if left empty.',
              type: 'localeString',
            }),
          ],
        }),
      ],
      validation: (rule) => rule.required().min(1),
    }),
  ],
  preview: {
    select: {
      title: 'name.ru',
      type: 'type',
      images: 'images',
    },
    prepare({title, type, images}) {
      const typeLabels: Record<string, string> = {
        photoStripe: 'Photo stripe',
        photoHorizontal: 'Photo horizontal',
        photoColumn: 'Photo column',
      }
      return {
        title: title || 'Untitled gallery',
        subtitle: `${typeLabels[type] || type} · ${(images || []).length} image${(images || []).length === 1 ? '' : 's'}`,
        media: images && images[0],
      }
    },
  },
})
