using InventoryManager.Interfaces;

namespace InventoryManager.Models
{
    public class Product : IInventoryItem
    {
        // Empty lines to reach line 14 for first property






        public string Name { get; set; }
        public int Quantity { get; set; }
        public decimal Price { get; set; }
        public string SKU { get; set; }
        public string Category { get; set; }
    }
}
