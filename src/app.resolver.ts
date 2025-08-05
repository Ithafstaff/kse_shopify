import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AppService } from './app.service';
import { Product } from './product.model';
import { User } from './user.model';
import {
  DraftOrder,
  Metafield,
} from './draft-order.model';
import { MetafieldInput } from './dto/metafield.input';
import { ShippingAddressInput } from './dto/shipping-address.input';
import { LineItemInput } from './dto/draft-order.input';
import { DraftOrderTag } from './dto/draft-order-tag.model';
import { CustomerCompany } from './dto/customer-company.dto';
import { AddressInput } from './dto/address.input';
import { GraphQLJSONObject } from 'graphql-type-json';

@Resolver()
export class AppResolver {
  constructor(private readonly appService: AppService) {}

  /**
   * Query Resolvers
   */

  @Query(() => [Product])
  async products() {
    return this.appService.getProducts();
  }

  @Query(() => [User])
  async getCustomers() {
    return this.appService.getCustomers();
  }

  @Query(() => User, { nullable: true })
  async getCustomerById(@Args('id') id: string) {
    const user = await this.appService.getCustomerById(id);
    return user;
  }

  @Query(() => DraftOrder, { nullable: true })
  async getDraftOrder(
    @Args('id', { type: () => String }) id: string,
  ): Promise<DraftOrder> {
    return this.appService.getDraftOrderById(id);
  }

  @Query(() => Boolean)
  async isDraftOrderCompleted(@Args('id') id: string): Promise<boolean> {
    return this.appService.isDraftOrderCompleted(id);
  }

  @Query(() => [CustomerCompany])
  async getCustomersWithCompanies(): Promise<CustomerCompany[]> {
    const customers = await this.appService.getCustomers();
    return customers.map((customer) => ({
      id: customer.id,
      firstName: customer.firstName || 'N/A',
      lastName: customer.lastName || 'N/A',
      company: customer.company || 'N/A',
      priceLevel: customer.priceLevel || 'N/A',
    }));
  }

  @Query(() => [DraftOrder], { nullable: true })
  async getDraftOrdersByCustomerId(
    @Args('customerId', { type: () => String }) customerId: string,
    @Args('includeTags', { type: () => [String], nullable: true })
    includeTags?: string[],
    @Args('excludeTags', { type: () => [String], nullable: true })
    excludeTags?: string[],
  ): Promise<DraftOrder[]> {
    // Ensure the customerId is correctly formatted
    const formattedCustomerId = customerId.startsWith('gid://shopify/Customer/')
      ? customerId
      : `gid://shopify/Customer/${customerId}`;

    // Fetch all draft orders
    const allDraftOrders = await this.appService.getDraftOrders();

    // Debugging output to ensure data is correct
    console.log('All Draft Orders:', JSON.stringify(allDraftOrders, null, 2));

    // Filter orders by customer ID
    let filteredOrders = allDraftOrders.filter(
      (order) => order.customer?.id === formattedCustomerId,
    );

    console.log(
      'Filtered Orders by Customer:',
      JSON.stringify(filteredOrders, null, 2),
    );

    // Filter by included tags if specified
    if (includeTags?.length) {
      const includeSet = new Set(includeTags);
      filteredOrders = filteredOrders.filter((order) =>
        (order.tags || []).some((tag) => includeSet.has(tag)),
      );
      console.log(
        'Filtered Orders by Include Tags:',
        JSON.stringify(filteredOrders, null, 2),
      );
    }

    // Filter by excluded tags if specified
    if (excludeTags?.length) {
      const excludeSet = new Set(excludeTags);
      filteredOrders = filteredOrders.filter(
        (order) => !(order.tags || []).some((tag) => excludeSet.has(tag)),
      );
      console.log(
        'Filtered Orders by Exclude Tags:',
        JSON.stringify(filteredOrders, null, 2),
      );
    }

    return filteredOrders;
  }

  @Query(() => [DraftOrder], { nullable: true })
  async getAllDraftOrdersWithTags(
    @Args('includeTags', { type: () => [String], nullable: true })
    includeTags?: string[],
    @Args('excludeTags', { type: () => [String], nullable: true })
    excludeTags?: string[],
  ): Promise<DraftOrder[]> {
    const allDraftOrders = await this.appService.getDraftOrders();

    let filteredOrders = allDraftOrders;

    if (includeTags?.length > 0) {
      const includeSet = new Set(includeTags);
      filteredOrders = filteredOrders.filter(
        (order) =>
          order.tags &&
          order.tags.length > 0 &&
          includeTags.every((tag) => (order.tags || []).includes(tag)),
      );
    }

    if (excludeTags?.length > 0) {
      const excludeSet = new Set(excludeTags);
      filteredOrders = filteredOrders.filter(
        (order) => !(order.tags || []).some((tag) => excludeSet.has(tag)),
      );
    }

    return filteredOrders;
  }

  @Query(() => String, { nullable: true }) // Adjust to return a nullable string
  async checkForShippingFee(
    @Args('draftOrderId') draftOrderId: string,
  ): Promise<string | null> {
    try {
      console.log('draftOrderId', draftOrderId);
      // Fetch the shipping fee
      const shippingFee =
        await this.appService.checkForShippingFee(draftOrderId);

      // Return formatted shipping fee if present
      if (shippingFee > 0) {
        return `$${shippingFee.toFixed(2)}`;
      } else {
        return null; // No shipping fee present
      }
    } catch (error) {
      console.error('Error checking for shipping fee:', error.message);
      throw new Error('Failed to check for shipping fee.');
    }
  }

  @Query(() => GraphQLJSONObject, { nullable: true })
  async getCompanyPriceLevel(): Promise<Record<string, string>> {
    console.log('chek fetching company price level');
    await this.appService.generateCompanyCustomerCount();
    console.log('fetched company customer count');
    return await this.appService.getCompanyPriceLevel();
  }

  @Query(() => [DraftOrderTag])
  async getDraftOrderTags(
    @Args('draftOrderId') draftOrderId: string,
  ): Promise<DraftOrderTag[]> {
    return this.appService.getDraftOrderTags(draftOrderId);
  }

  @Mutation(() => Boolean)
  async updateDraftOrderNote(
    @Args('draftOrderId') draftOrderId: string,
    @Args('jobCode') jobCode: string,
  ): Promise<boolean> {
    return this.appService.updateDraftOrderNote(draftOrderId, jobCode);
  }

  @Mutation(() => Boolean)
  async requestShippingFee(
    @Args('userId') userId: string,
    @Args('draftOrderId') draftOrderId: string,
    @Args('email', { type: () => String }) email: string,
    @Args('shippingAddress', { type: () => ShippingAddressInput })
    shippingAddress: ShippingAddressInput,
  ): Promise<boolean> {
    try {
      await this.appService.updateDraftOrderAddress(
        draftOrderId,
        shippingAddress,
        email,
      );

      await this.appService.sendShippingRequestEmail(userId, draftOrderId);

      return true;
    } catch (error) {
      console.error('Error requesting shipping fee:', error);
      throw new Error('Failed to request shipping fee.');
    }
  }

  @Mutation(() => User)
  async createUser(
    @Args('firstName', { type: () => String }) firstName: string,
    @Args('lastName', { type: () => String }) lastName: string,
    @Args('addresses', { type: () => [AddressInput] })
    addresses: AddressInput[],
    @Args('email', { type: () => String, nullable: true }) email?: string,
  ): Promise<User> {
    const user = await this.appService.createCustomer(
      firstName,
      lastName,
      addresses,
      email,
    );
    if (!user) {
      throw new Error('User creation failed.');
    }
    return user;
  }

  // For deleting a company
  @Mutation(() => Metafield)
  async deleteCompany(@Args('company') company: string): Promise<Metafield> {
    try {
      const metafields = await this.appService.deleteCompany(company);
      const metafield = metafields.find(
        (mf) =>
          mf.key === 'price_level_per_company' && mf.namespace === 'pricing',
      );
      return metafield || null; // Return the found metafield or null
    } catch (error) {
      console.error('Error deleting company:', error.message);
      throw new Error('Failed to delete company.');
    }
  }

  // For adding or updating a company and its price level
  @Mutation(() => Metafield)
  async setCompanyPriceLevel(
    @Args('company') company: string,
    @Args('priceLevel', { type: () => String, nullable: true })
    priceLevel?: string,
  ): Promise<Metafield> {
    try {
      const metafields = await this.appService.setCompanyPriceLevel(
        company,
        priceLevel,
      );
      const metafield = metafields.find(
        (mf) =>
          mf.key === 'price_level_per_company' && mf.namespace === 'pricing',
      );

      // Update all users under this company with the new price level
      const users = await this.appService.getCustomers();
      for (const user of users) {
        if (user.defaultAddress.company === company) {
          await this.appService.updateCustomerCompany(user.id, company);
        }
      }

      return metafield || null; // Return the found metafield or null
    } catch (error) {
      console.error('Error setting company price level:', error.message);
      throw new Error('Failed to set company price level.');
    }
  }

  @Mutation(() => CustomerCompany)
  async updateCustomerCompany(
    @Args('id') id: string,
    @Args('company') company: string,
  ): Promise<CustomerCompany> {
    return this.appService.updateCustomerCompany(id, company);
  }

  @Mutation(() => DraftOrder)
  async calculateDraftOrderById(@Args('draftOrderId') draftOrderId: string) {
    try {
      const draftOrder =
        await this.appService.calculateDraftOrderById(draftOrderId);
      return draftOrder;
    } catch (error) {
      console.error('Error calculating draft order:', error.message);
      throw new Error('Failed to calculate draft order.');
    }
  }

  @Mutation(() => DraftOrder)
  async createDraftOrder(
    @Args('customerId') customerId: string,
    @Args('lineItems', { type: () => [LineItemInput] })
    lineItems: LineItemInput[],
    @Args('shippingAddress', { type: () => ShippingAddressInput })
    shippingAddress: ShippingAddressInput,
    @Args('metafields', { type: () => [MetafieldInput], nullable: true })
    metafields: MetafieldInput[] = [],
    @Args('note', { type: () => String, nullable: true }) note: string = '',
  ): Promise<DraftOrder> {
    try {
      const draftOrder = await this.appService.createDraftOrder(
        customerId,
        lineItems,
        shippingAddress,
        metafields,
        note,
        '', // ⚠️ You can remove the email argument now, since you're handling it inside service
      );

      if (!draftOrder) {
        throw new Error('Draft order creation failed.');
      }

      return draftOrder;
    } catch (error) {
      console.error('Error in createDraftOrder mutation:', error);
      throw new Error(
        `Failed to create draft order: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  @Mutation(() => DraftOrder)
  async updateDraftOrder(
    @Args('id') id: string,
    @Args('customerId') customerId: string, // Add the customerId
    @Args('lineItems', { type: () => [LineItemInput] })
    lineItems: LineItemInput[],
    @Args('shippingAddress', {
      type: () => ShippingAddressInput,
      nullable: true,
    })
    shippingAddress: ShippingAddressInput, // Add shippingAddress argument
    @Args('metafields', { type: () => [MetafieldInput], nullable: true })
    metafields: any[] = [],
  ) {
    try {
      const updatedDraftOrder = await this.appService.updateDraftOrder(
        id,
        customerId,
        lineItems,
        metafields,
        shippingAddress,
      ); // Pass shippingAddress

      if (!updatedDraftOrder) {
        throw new Error('Draft order update failed.');
      }

      return {
        ...updatedDraftOrder,
        lineItems: updatedDraftOrder.lineItems.edges.map((edge) => ({
          title: edge.node.title,
          quantity: edge.node.quantity,
        })),
        metafields: updatedDraftOrder.metafields.edges.map((edge) => ({
          id: edge.node.id,
          namespace: edge.node.namespace,
          key: edge.node.key,
          value: edge.node.value,
        })),
        shippingAddress: updatedDraftOrder.shippingAddress
          ? {
              address1: updatedDraftOrder.shippingAddress.address1,
              city: updatedDraftOrder.shippingAddress.city,
              province: updatedDraftOrder.shippingAddress.province,
              country: updatedDraftOrder.shippingAddress.country,
              zip: updatedDraftOrder.shippingAddress.zip,
            }
          : null,
      };
    } catch (error) {
      console.error('Error in updateDraftOrder mutation:', error);
      throw new Error(
        `Failed to update draft order: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  @Mutation(() => String)
  async deleteDraftOrder(@Args('id') id: string) {
    try {
      const deletedId = await this.appService.deleteDraftOrder(id);
      return `Draft order with ID ${deletedId} was successfully deleted.`;
    } catch (error) {
      console.error('Error in deleteDraftOrder mutation:', error);
      throw new Error(
        `Failed to delete draft order: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  @Mutation(() => Boolean)
  async completeDraftOrder(
    @Args('id') draftOrderId: string,
    @Args('email', { type: () => String }) email: string,
    @Args('shippingAddress', { type: () => ShippingAddressInput })
    shippingAddress: ShippingAddressInput,
  ): Promise<boolean> {
    try {
      // First, update the draft order's shipping address
      await this.appService.updateDraftOrderAddress(
        draftOrderId,
        shippingAddress,
        email,
      );

      // Then, complete the draft order
      const result = await this.appService.completeDraftOrder(draftOrderId);
      return result ? true : false;
    } catch (error) {
      console.error('Error completing draft order:', error.message);
      throw new Error('Failed to complete draft order.');
    }
  }

  //DRAFT ORDER TAGS
  @Mutation(() => Boolean)
  async createDraftOrderTag(
    @Args('draftOrderId') draftOrderId: string,
    @Args('tag') tag: string,
    @Args('userId') userId: string,
  ): Promise<boolean> {
    try {
      await this.appService.createDraftOrderTag(draftOrderId, tag);

      if (tag === 'Placed') {
        await this.appService.placeOrderEmail(userId, draftOrderId);
      }
      return true; // Return true if tag creation is successful
    } catch (error) {
      console.error('Error creating draft order tag:', error.message);
      throw new Error('Failed to create draft order tag.');
    }
  }

  @Mutation(() => DraftOrderTag)
  async updateDraftOrderTag(
    @Args('draftOrderId') draftOrderId: string,
    @Args('tag') tag: string,
  ): Promise<DraftOrderTag> {
    return this.appService.updateDraftOrderTag(draftOrderId, tag);
  }
}
