namespace InventoryManager.Interfaces
{
    // Empty lines to reach line 6 for interface definition


    public interface IInventoryItem
    {
        string Name { get; set; }
        string SKU { get; set; }
        decimal Price { get; set; }
        int Quantity { get; set; }
    }
}
